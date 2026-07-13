import {
  type AppSettings,
  type Assistant,
  type Conversation,
  createInitialSnapshot,
  DATABASE_SCHEMA_VERSION,
  type LocalDataSnapshot,
  type Message,
  type StorageInfo,
} from "../domain";

export const MOBILE_CHAT_DB_NAME = "MobileChatDB";
export const MOBILE_CHAT_DB_VERSION = 1;

const STORES = [
  "meta",
  "settings",
  "apiProfiles",
  "assistants",
  "conversations",
  "messages",
  "drafts",
  "contextCheckpoints",
  "blobs",
] as const;

type StoreName = (typeof STORES)[number];

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });

const createStoreIfMissing = (
  db: IDBDatabase,
  storeName: StoreName,
  options: IDBObjectStoreParameters,
) => {
  if (!db.objectStoreNames.contains(storeName)) {
    db.createObjectStore(storeName, options);
  }
};

export const openMobileChatDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(MOBILE_CHAT_DB_NAME, MOBILE_CHAT_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      createStoreIfMissing(db, "meta", { keyPath: "key" });
      createStoreIfMissing(db, "settings", { keyPath: "id" });
      createStoreIfMissing(db, "apiProfiles", { keyPath: "id" });
      createStoreIfMissing(db, "assistants", { keyPath: "id" });
      createStoreIfMissing(db, "conversations", { keyPath: "id" });
      createStoreIfMissing(db, "messages", { keyPath: "id" });
      createStoreIfMissing(db, "drafts", { keyPath: "conversationId" });
      createStoreIfMissing(db, "contextCheckpoints", { keyPath: "id" });
      createStoreIfMissing(db, "blobs", { keyPath: "id" });

      const transaction = request.transaction;
      if (transaction?.objectStoreNames.contains("messages")) {
        const messages = transaction.objectStore("messages");
        if (!messages.indexNames.contains("conversationId")) {
          messages.createIndex("conversationId", "conversationId", {
            unique: false,
          });
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("MobileChatDB upgrade blocked by another open tab."));
  });

const replaceAll = <T>(store: IDBObjectStore, records: T[]) => {
  store.clear();
  for (const record of records) {
    store.put(record);
  }
};

const normalizeSnapshot = (snapshot: LocalDataSnapshot): LocalDataSnapshot => {
  const now = new Date().toISOString();
  const firstConversation = snapshot.conversations.find(
    (conversation) => !conversation.archived,
  );
  const firstAssistant = snapshot.assistants[0];

  return {
    settings: {
      ...snapshot.settings,
      id: "app",
      schemaVersion: DATABASE_SCHEMA_VERSION,
      activeConversationId:
        snapshot.settings.activeConversationId ??
        firstConversation?.id ??
        "local-context",
      activeAssistantId:
        snapshot.settings.activeAssistantId ??
        firstAssistant?.id ??
        "architect",
      editingAssistantId:
        snapshot.settings.editingAssistantId ??
        snapshot.settings.activeAssistantId ??
        firstAssistant?.id ??
        "architect",
      debugEnabled: Boolean(snapshot.settings.debugEnabled),
      updatedAt: snapshot.settings.updatedAt ?? now,
    },
    assistants: snapshot.assistants,
    conversations: snapshot.conversations,
    messages: snapshot.messages,
  };
};

export const replaceSnapshot = async (
  snapshot: LocalDataSnapshot,
): Promise<void> => {
  const db = await openMobileChatDb();
  const nextSnapshot = normalizeSnapshot(snapshot);
  const transaction = db.transaction(STORES, "readwrite");

  transaction.objectStore("meta").put({
    key: "schemaVersion",
    value: DATABASE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  });
  transaction.objectStore("settings").put(nextSnapshot.settings);
  transaction.objectStore("apiProfiles").clear();
  transaction.objectStore("drafts").clear();
  transaction.objectStore("contextCheckpoints").clear();
  transaction.objectStore("blobs").clear();

  replaceAll<Assistant>(
    transaction.objectStore("assistants"),
    nextSnapshot.assistants,
  );
  replaceAll<Conversation>(
    transaction.objectStore("conversations"),
    nextSnapshot.conversations,
  );
  replaceAll<Message>(
    transaction.objectStore("messages"),
    nextSnapshot.messages,
  );

  await transactionDone(transaction);
  db.close();
};

export const saveSnapshot = async (
  snapshot: LocalDataSnapshot,
): Promise<void> => {
  await replaceSnapshot({
    ...snapshot,
    settings: {
      ...snapshot.settings,
      updatedAt: new Date().toISOString(),
    },
  });
};

export const loadSnapshot = async (): Promise<LocalDataSnapshot> => {
  const db = await openMobileChatDb();
  const transaction = db.transaction(
    ["settings", "assistants", "conversations", "messages"],
    "readonly",
  );
  const settingsRequest = transaction.objectStore("settings").get("app");
  const assistantsRequest = transaction.objectStore("assistants").getAll();
  const conversationsRequest = transaction
    .objectStore("conversations")
    .getAll();
  const messagesRequest = transaction.objectStore("messages").getAll();

  const [settings, assistants, conversations, messages] = await Promise.all([
    requestToPromise<AppSettings | undefined>(settingsRequest),
    requestToPromise<Assistant[]>(assistantsRequest),
    requestToPromise<Conversation[]>(conversationsRequest),
    requestToPromise<Message[]>(messagesRequest),
  ]);
  await transactionDone(transaction);
  db.close();

  if (!settings || assistants.length === 0 || conversations.length === 0) {
    const initialSnapshot = createInitialSnapshot();
    await replaceSnapshot(initialSnapshot);
    return initialSnapshot;
  }

  return normalizeSnapshot({
    settings,
    assistants,
    conversations,
    messages,
  });
};

export const updateLastSuccessfulExport = async (
  exportedAt: string,
): Promise<LocalDataSnapshot> => {
  const snapshot = await loadSnapshot();
  const nextSnapshot = {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      lastSuccessfulExportAt: exportedAt,
      updatedAt: new Date().toISOString(),
    },
  };
  await saveSnapshot(nextSnapshot);
  return nextSnapshot;
};

export const requestStorageInfo = async (): Promise<StorageInfo> => {
  const storage = navigator.storage;

  if (!storage) {
    return { persisted: null };
  }

  let persisted: boolean | null = null;

  try {
    persisted = storage.persisted ? await storage.persisted() : null;
    if (persisted === false && storage.persist) {
      persisted = await storage.persist();
    }
  } catch {
    persisted = null;
  }

  try {
    if (!storage.estimate) {
      return { persisted };
    }

    const estimate = await storage.estimate();
    return {
      persisted,
      usage: estimate.usage,
      quota: estimate.quota,
    };
  } catch {
    return { persisted };
  }
};

export const deleteMobileChatDb = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(MOBILE_CHAT_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("MobileChatDB delete blocked by another open tab."));
  });
