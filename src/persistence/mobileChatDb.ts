import {
  type ApiProfile,
  type AppSettings,
  type Assistant,
  type AssistantModelBinding,
  type Conversation,
  createInitialSnapshot,
  DATABASE_SCHEMA_VERSION,
  DEFAULT_MODEL_REF,
  initialApiProfiles,
  type LocalDataSnapshot,
  type Message,
  type ModelDefinition,
  type ModelRef,
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
type LegacyAssistant = Assistant & {
  apiProfileName?: string;
  model?: string;
};
type LegacyMessage = Omit<Message, "createdAt"> & {
  createdAt?: string;
};
type LegacySettings = Partial<AppSettings> & {
  activeModelRef?: ModelRef;
  themeMode?: AppSettings["themeMode"];
  desktopLayoutEnabled?: boolean;
  streamingEnabled?: boolean;
};
type LegacyModelDefinition = ModelDefinition & {
  webSearchEnabled?: unknown;
};
type SnapshotInput = Omit<
  Partial<LocalDataSnapshot>,
  "settings" | "assistants" | "messages"
> & {
  settings?: LegacySettings;
  assistants?: LegacyAssistant[];
  messages?: LegacyMessage[];
};

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

const cloneInitialApiProfiles = (): ApiProfile[] =>
  initialApiProfiles.map((profile) => ({
    ...profile,
    models: profile.models.map((model) => normalizeModel(model)),
  }));

const normalizeModel = (model: LegacyModelDefinition): ModelDefinition => {
  const { webSearchEnabled: _legacyWebSearchEnabled, ...normalized } = model;
  return normalized;
};

const normalizeApiProfiles = (apiProfiles: ApiProfile[]): ApiProfile[] =>
  apiProfiles.map((profile) => ({
    ...profile,
    models: profile.models.map((model) => normalizeModel(model)),
  }));

const findModelInProfiles = (apiProfiles: ApiProfile[], ref: ModelRef) => {
  const apiProfile = apiProfiles.find(
    (profile) => profile.id === ref.apiProfileId,
  );
  const model = apiProfile?.models.find(
    (candidate) => candidate.id === ref.modelId,
  );
  return { apiProfile, model };
};

const bindingFromRef = (
  apiProfiles: ApiProfile[],
  ref: ModelRef,
  isDefault: boolean,
): AssistantModelBinding => {
  const { apiProfile, model } = findModelInProfiles(apiProfiles, ref);
  return {
    apiProfileId: ref.apiProfileId,
    modelId: ref.modelId,
    enabled: true,
    isDefault,
    apiProfileNameSnapshot: apiProfile?.name ?? ref.apiProfileId,
    modelNameSnapshot: model?.name ?? ref.modelId,
    modelDescriptionSnapshot: model?.description ?? "",
  };
};

const migrateAssistant = (
  assistant: LegacyAssistant,
  apiProfiles: ApiProfile[],
): Assistant => {
  const migratedBindings =
    Array.isArray(assistant.modelBindings) && assistant.modelBindings.length > 0
      ? assistant.modelBindings
      : [
          bindingFromRef(
            apiProfiles,
            {
              apiProfileId:
                apiProfiles.find(
                  (profile) =>
                    profile.name === assistant.apiProfileName ||
                    profile.id === assistant.apiProfileName,
                )?.id ?? DEFAULT_MODEL_REF.apiProfileId,
              modelId: assistant.model ?? DEFAULT_MODEL_REF.modelId,
            },
            true,
          ),
        ];

  const hasDefault = migratedBindings.some((binding) => binding.isDefault);
  return {
    id: assistant.id,
    name: assistant.name,
    description: assistant.description ?? "",
    kind: assistant.kind ?? "chat",
    modelBindings: migratedBindings.map((binding, index) => {
      const { apiProfile, model } = findModelInProfiles(apiProfiles, binding);
      return {
        apiProfileId: binding.apiProfileId,
        modelId: binding.modelId,
        enabled: binding.enabled !== false,
        isDefault: hasDefault ? Boolean(binding.isDefault) : index === 0,
        apiProfileNameSnapshot:
          apiProfile?.name ??
          binding.apiProfileNameSnapshot ??
          binding.apiProfileId,
        modelNameSnapshot:
          model?.name ?? binding.modelNameSnapshot ?? binding.modelId,
        modelDescriptionSnapshot:
          binding.modelDescriptionSnapshot ?? model?.description ?? "",
      };
    }),
    prompt: assistant.prompt ?? "",
    initialMessage: assistant.initialMessage ?? "",
    enabled: assistant.enabled !== false,
  };
};

const parseCreatedAtFromMessageId = (
  messageId: string,
  fallbackIndex: number,
): string => {
  const timestampPart = messageId.split("-")[1];
  const timestamp = timestampPart ? Number.parseInt(timestampPart, 36) : NaN;

  if (Number.isFinite(timestamp) && timestamp > 0) {
    return new Date(timestamp).toISOString();
  }

  return new Date(Date.UTC(2026, 6, 13, 0, 0, 0, fallbackIndex)).toISOString();
};

const migrateMessages = (messages: LegacyMessage[]): Message[] =>
  messages.map((message, index) => ({
    ...message,
    createdAt:
      message.createdAt ?? parseCreatedAtFromMessageId(message.id, index),
  }));

export const normalizeSnapshot = (
  snapshot: SnapshotInput,
): LocalDataSnapshot => {
  const initialSnapshot = createInitialSnapshot();
  const now = new Date().toISOString();
  const apiProfiles =
    snapshot.apiProfiles && snapshot.apiProfiles.length > 0
      ? normalizeApiProfiles(snapshot.apiProfiles)
      : cloneInitialApiProfiles();
  const assistants =
    snapshot.assistants && snapshot.assistants.length > 0
      ? snapshot.assistants.map((assistant) =>
          migrateAssistant(assistant, apiProfiles),
        )
      : initialSnapshot.assistants;
  const conversations =
    snapshot.conversations && snapshot.conversations.length > 0
      ? snapshot.conversations
      : initialSnapshot.conversations;
  const messages = snapshot.messages
    ? migrateMessages(snapshot.messages)
    : initialSnapshot.messages;
  const firstConversation = conversations.find(
    (conversation) => !conversation.archived,
  );
  const firstAssistant = assistants[0];
  const settings: LegacySettings = snapshot.settings ?? {};

  return {
    settings: {
      id: "app",
      schemaVersion: DATABASE_SCHEMA_VERSION,
      activeConversationId:
        settings.activeConversationId ??
        firstConversation?.id ??
        initialSnapshot.settings.activeConversationId,
      activeAssistantId:
        settings.activeAssistantId ??
        firstAssistant?.id ??
        initialSnapshot.settings.activeAssistantId,
      activeModelRef: settings.activeModelRef ?? DEFAULT_MODEL_REF,
      editingAssistantId:
        settings.editingAssistantId ??
        settings.activeAssistantId ??
        firstAssistant?.id ??
        initialSnapshot.settings.editingAssistantId,
      themeMode: settings.themeMode ?? "system",
      layoutMode:
        settings.layoutMode ??
        (typeof settings.desktopLayoutEnabled === "boolean"
          ? settings.desktopLayoutEnabled
            ? "desktop"
            : "mobile"
          : initialSnapshot.settings.layoutMode),
      streamingEnabled:
        settings.streamingEnabled ?? initialSnapshot.settings.streamingEnabled,
      debugEnabled:
        settings.debugEnabled ?? initialSnapshot.settings.debugEnabled,
      lastSuccessfulExportAt: settings.lastSuccessfulExportAt,
      storagePersisted: settings.storagePersisted ?? null,
      storageUsage: settings.storageUsage,
      storageQuota: settings.storageQuota,
      updatedAt: settings.updatedAt ?? now,
    },
    apiProfiles,
    assistants,
    conversations,
    messages,
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
  transaction.objectStore("drafts").clear();
  transaction.objectStore("contextCheckpoints").clear();
  transaction.objectStore("blobs").clear();

  replaceAll<ApiProfile>(
    transaction.objectStore("apiProfiles"),
    nextSnapshot.apiProfiles,
  );
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
    ["settings", "apiProfiles", "assistants", "conversations", "messages"],
    "readonly",
  );
  const settingsRequest = transaction.objectStore("settings").get("app");
  const apiProfilesRequest = transaction.objectStore("apiProfiles").getAll();
  const assistantsRequest = transaction.objectStore("assistants").getAll();
  const conversationsRequest = transaction
    .objectStore("conversations")
    .getAll();
  const messagesRequest = transaction.objectStore("messages").getAll();

  const [settings, apiProfiles, assistants, conversations, messages] =
    await Promise.all([
      requestToPromise<LegacySettings | undefined>(settingsRequest),
      requestToPromise<ApiProfile[]>(apiProfilesRequest),
      requestToPromise<LegacyAssistant[]>(assistantsRequest),
      requestToPromise<Conversation[]>(conversationsRequest),
      requestToPromise<LegacyMessage[]>(messagesRequest),
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
    apiProfiles,
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
