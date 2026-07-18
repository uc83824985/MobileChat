import {
  type ApiProfile,
  type AppSettings,
  type Assistant,
  type Conversation,
  type ContextSummaryFramework,
  createInitialSnapshot,
  DATABASE_SCHEMA_VERSION,
  defaultContextProfile,
  defaultContextProfileWorkflowDraft,
  defaultContextSummaryFramework,
  defaultUtilityAssistantRefs,
  DEFAULT_CONTEXT_PROFILE_SUMMARY_MAX_CHARS,
  DEFAULT_CONTEXT_SUMMARY_AUTO_MESSAGE_INTERVAL,
  DEFAULT_CONTEXT_SUMMARY_RAW_TAIL_MESSAGES,
  DEFAULT_MODEL_REF,
  initialApiProfiles,
  type LocalBlobRecord,
  type LocalDataSnapshot,
  type Message,
  type ModelRef,
  normalizeMessageQuoteTemplate,
  type StorageInfo,
} from "../domain";
import { normalizeModelProbeSettings } from "../modelProbe";

// Persistence-critical constant. Changing this creates a new IndexedDB database
// inside the same browser/WebView origin and will look like data loss.
export const MOBILE_CHAT_DB_NAME = "MobileChatDB";
export const MOBILE_CHAT_DB_VERSION = 1;

const LEGACY_SEEDED_MODEL_ID = "default-model";

const isLegacySeededDefaultModelRef = (ref: ModelRef) =>
  ref.apiProfileId === DEFAULT_MODEL_REF.apiProfileId &&
  ref.modelId === LEGACY_SEEDED_MODEL_ID;

const STORES = [
  "meta",
  "settings",
  "apiProfiles",
  "assistants",
  "conversations",
  "messages",
  "drafts",
  "blobs",
] as const;

type StoreName = (typeof STORES)[number];
type PartialSettings = Partial<AppSettings> & {
  contextSummaryFramework?: Partial<ContextSummaryFramework>;
};
type SnapshotInput = Omit<
  Partial<LocalDataSnapshot>,
  "settings" | "assistants" | "conversations" | "messages"
> & {
  settings?: PartialSettings;
  assistants?: Assistant[];
  conversations?: Conversation[];
  messages?: Message[];
  blobs?: LocalBlobRecord[];
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
    id: profile.id,
    name: profile.name,
    description: profile.description,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    protocol: profile.protocol,
    enabled: profile.enabled,
    models: profile.models.map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description,
      enabled: model.enabled,
    })),
  }));

const cloneApiProfiles = (apiProfiles: ApiProfile[]): ApiProfile[] =>
  apiProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: profile.description,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    protocol: profile.protocol,
    enabled: profile.enabled,
    models: profile.models
      .filter(
        (model) =>
          !(
            profile.id === DEFAULT_MODEL_REF.apiProfileId &&
            model.id === LEGACY_SEEDED_MODEL_ID
          ),
      )
      .map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        enabled: model.enabled,
      })),
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

const sortRecordsByStoredOrder = <T extends { id: string }>(
  records: T[],
  order?: string[],
): T[] => {
  if (!Array.isArray(order) || order.length === 0) {
    return records;
  }

  const orderIndex = new Map(order.map((id, index) => [id, index]));

  return records
    .map((record, originalIndex) => ({ record, originalIndex }))
    .sort((left, right) => {
      const leftIndex = orderIndex.get(left.record.id);
      const rightIndex = orderIndex.get(right.record.id);

      if (leftIndex !== undefined && rightIndex !== undefined) {
        return leftIndex - rightIndex;
      }
      if (leftIndex !== undefined) {
        return -1;
      }
      if (rightIndex !== undefined) {
        return 1;
      }
      return left.originalIndex - right.originalIndex;
    })
    .map(({ record }) => record);
};

const normalizeAssistant = (
  assistant: Assistant,
  apiProfiles: ApiProfile[],
  contextProfiles: AppSettings["contextProfiles"],
): Assistant => {
  const modelBindings = (
    Array.isArray(assistant.modelBindings) ? assistant.modelBindings : []
  ).filter((binding) => !isLegacySeededDefaultModelRef(binding));
  const hasDefault = modelBindings.some((binding) => binding.isDefault);
  const contextProfileId =
    contextProfiles.find((profile) => profile.id === assistant.contextProfileId)
      ?.id ??
    contextProfiles[0]?.id ??
    defaultContextProfile.id;

  return {
    id: assistant.id,
    name: assistant.name,
    description: assistant.description ?? "",
    kind: assistant.kind ?? "chat",
    ...(assistant.kind === "utility"
      ? {
          utilityModelStrategy:
            assistant.utilityModelStrategy === "fixed"
              ? "fixed"
              : "follow-conversation",
        }
      : {}),
    modelBindings: modelBindings.map((binding, index) => {
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
    contextProfileId,
    enabled: assistant.enabled !== false,
  };
};

const normalizeMessages = (messages: Message[], now: string): Message[] =>
  messages.map((message) => ({
    ...message,
    createdAt: message.createdAt ?? now,
    imageParts: Array.isArray(message.imageParts)
      ? message.imageParts.map((part) => ({
          id: part.id,
          type: "image",
          blobId: part.blobId,
          mimeType: part.mimeType,
          name: part.name ?? "image",
          size:
            typeof part.size === "number" && Number.isFinite(part.size)
              ? Math.max(0, part.size)
              : 0,
          referenceLabel:
            typeof part.referenceLabel === "string"
              ? part.referenceLabel
              : undefined,
        }))
      : undefined,
  }));

const normalizeBlobs = (blobs?: LocalBlobRecord[]): LocalBlobRecord[] =>
  Array.isArray(blobs)
    ? blobs
        .filter(
          (blob) =>
            blob &&
            blob.kind === "image" &&
            typeof blob.id === "string" &&
            typeof blob.dataUrl === "string" &&
            blob.dataUrl.startsWith("data:image/"),
        )
        .map((blob) => ({
          id: blob.id,
          kind: "image",
          mimeType: blob.mimeType || "image/*",
          name: blob.name || "image",
          size:
            typeof blob.size === "number" && Number.isFinite(blob.size)
              ? Math.max(0, blob.size)
              : 0,
          dataUrl: blob.dataUrl,
          createdAt: blob.createdAt || new Date().toISOString(),
        }))
    : [];

const normalizeContextSummaryRawTailMessages = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CONTEXT_SUMMARY_RAW_TAIL_MESSAGES;
  }

  return Math.max(0, Math.min(50, Math.trunc(value)));
};

const normalizeContextSummaryAutoMessageInterval = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CONTEXT_SUMMARY_AUTO_MESSAGE_INTERVAL;
  }

  return Math.max(0, Math.min(100, Math.trunc(value)));
};

const normalizeContextProfileSummaryMaxChars = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CONTEXT_PROFILE_SUMMARY_MAX_CHARS;
  }

  return Math.max(500, Math.min(50000, Math.trunc(value)));
};

const normalizeContextSummaryFramework = (
  framework?: Partial<ContextSummaryFramework>,
): ContextSummaryFramework => {
  const incomingSections = Array.isArray(framework?.sections)
    ? framework.sections
    : [];

  return {
    ...defaultContextSummaryFramework,
    sections: defaultContextSummaryFramework.sections.map((defaultSection) => {
      const incomingSection = incomingSections.find(
        (section) => section.id === defaultSection.id,
      );
      return {
        ...defaultSection,
        instruction:
          typeof incomingSection?.instruction === "string"
            ? incomingSection.instruction
            : defaultSection.instruction,
      };
    }),
  };
};

const normalizeContextProfiles = (
  profiles?: AppSettings["contextProfiles"],
): AppSettings["contextProfiles"] =>
  Array.isArray(profiles) && profiles.length > 0
    ? profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        summaryMaxChars: normalizeContextProfileSummaryMaxChars(
          profile.summaryMaxChars,
        ),
        dimensionOverrides: Array.isArray(profile.dimensionOverrides)
          ? profile.dimensionOverrides.map((override) => ({
              dimensionId: override.dimensionId,
              enabled: override.enabled !== false,
              titleOverride: override.titleOverride,
              instruction: override.instruction,
            }))
          : [],
      }))
    : [defaultContextProfile];

const normalizeContextProfileWorkflowDraft = (
  draft?: Partial<AppSettings["contextProfileWorkflowDraft"]>,
): AppSettings["contextProfileWorkflowDraft"] => ({
  standardOutput:
    typeof draft?.standardOutput === "string"
      ? draft.standardOutput
      : defaultContextProfileWorkflowDraft.standardOutput,
});

const normalizeConversation = (conversation: Conversation): Conversation => {
  const contextSummaries =
    Array.isArray(conversation.contextSummaries) &&
    conversation.contextSummaries.length > 0
      ? conversation.contextSummaries
      : [];
  const activeContextSummaryId =
    conversation.activeContextSummaryId ??
    contextSummaries.find((summary) => summary.status === "active")?.id ??
    contextSummaries[0]?.id;
  const hasActiveSummary = contextSummaries.some(
    (summary) => summary.id === activeContextSummaryId,
  );

  return {
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    archived: conversation.archived,
    contextSummaries:
      contextSummaries.length > 0 ? contextSummaries : undefined,
    activeContextSummaryId: hasActiveSummary
      ? activeContextSummaryId
      : undefined,
  };
};

export const normalizeSnapshot = (
  snapshot: SnapshotInput,
): LocalDataSnapshot => {
  const initialSnapshot = createInitialSnapshot();
  const now = new Date().toISOString();
  const settings: PartialSettings = snapshot.settings ?? {};
  const apiProfiles = sortRecordsByStoredOrder(
    snapshot.apiProfiles
      ? cloneApiProfiles(snapshot.apiProfiles)
      : cloneInitialApiProfiles(),
    settings.apiProfileOrder,
  );
  const contextProfiles = normalizeContextProfiles(settings.contextProfiles);
  const assistants = sortRecordsByStoredOrder(
    snapshot.assistants
      ? snapshot.assistants.map((assistant) =>
          normalizeAssistant(assistant, apiProfiles, contextProfiles),
        )
      : initialSnapshot.assistants.map((assistant) =>
          normalizeAssistant(assistant, apiProfiles, contextProfiles),
        ),
    settings.assistantOrder,
  );
  const conversations = snapshot.conversations
    ? snapshot.conversations.map((conversation) =>
        normalizeConversation(conversation),
      )
    : initialSnapshot.conversations;
  const messages = snapshot.messages
    ? normalizeMessages(snapshot.messages, now)
    : initialSnapshot.messages;
  const blobs = normalizeBlobs(snapshot.blobs);
  const firstConversation = conversations.find(
    (conversation) => !conversation.archived,
  );
  const firstAssistant = assistants[0];

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
      activeModelRef:
        settings.activeModelRef &&
        !isLegacySeededDefaultModelRef(settings.activeModelRef)
          ? settings.activeModelRef
          : DEFAULT_MODEL_REF,
      editingAssistantId:
        settings.editingAssistantId ??
        settings.activeAssistantId ??
        firstAssistant?.id ??
        initialSnapshot.settings.editingAssistantId,
      themeMode: settings.themeMode ?? "system",
      layoutMode: settings.layoutMode ?? initialSnapshot.settings.layoutMode,
      hideMobileStatusBar:
        settings.hideMobileStatusBar ??
        initialSnapshot.settings.hideMobileStatusBar,
      streamingEnabled:
        settings.streamingEnabled ?? initialSnapshot.settings.streamingEnabled,
      composerSubmitMode:
        settings.composerSubmitMode ??
        initialSnapshot.settings.composerSubmitMode,
      messageQuoteTemplate: normalizeMessageQuoteTemplate(
        settings.messageQuoteTemplate,
      ),
      contextSummaryRawTailMessages: normalizeContextSummaryRawTailMessages(
        settings.contextSummaryRawTailMessages,
      ),
      contextSummaryAutoMessageInterval:
        normalizeContextSummaryAutoMessageInterval(
          settings.contextSummaryAutoMessageInterval,
        ),
      debugEnabled:
        settings.debugEnabled ?? initialSnapshot.settings.debugEnabled,
      apiProfileOrder: apiProfiles.map((profile) => profile.id),
      assistantOrder: assistants.map((assistant) => assistant.id),
      utilityAssistantRefs: {
        contextSummaryAssistantId:
          settings.utilityAssistantRefs?.contextSummaryAssistantId ??
          defaultUtilityAssistantRefs.contextSummaryAssistantId,
      },
      modelProbeSettings: normalizeModelProbeSettings(
        settings.modelProbeSettings,
      ),
      contextSummaryFramework: normalizeContextSummaryFramework(
        settings.contextSummaryFramework,
      ),
      lastSuccessfulExportAt: settings.lastSuccessfulExportAt,
      storagePersisted: settings.storagePersisted ?? null,
      storageUsage: settings.storageUsage,
      storageQuota: settings.storageQuota,
      contextProfiles,
      contextProfileWorkflowDraft: normalizeContextProfileWorkflowDraft(
        settings.contextProfileWorkflowDraft,
      ),
      editingContextProfileId:
        contextProfiles.find(
          (profile) => profile.id === settings.editingContextProfileId,
        )?.id ??
        contextProfiles[0]?.id ??
        defaultContextProfile.id,
      updatedAt: settings.updatedAt ?? now,
    },
    apiProfiles,
    assistants,
    conversations,
    messages,
    blobs,
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
  replaceAll<LocalBlobRecord>(
    transaction.objectStore("blobs"),
    nextSnapshot.blobs,
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
    [
      "settings",
      "apiProfiles",
      "assistants",
      "conversations",
      "messages",
      "blobs",
    ],
    "readonly",
  );
  const settingsRequest = transaction.objectStore("settings").get("app");
  const apiProfilesRequest = transaction.objectStore("apiProfiles").getAll();
  const assistantsRequest = transaction.objectStore("assistants").getAll();
  const conversationsRequest = transaction
    .objectStore("conversations")
    .getAll();
  const messagesRequest = transaction.objectStore("messages").getAll();
  const blobsRequest = transaction.objectStore("blobs").getAll();

  const [settings, apiProfiles, assistants, conversations, messages, blobs] =
    await Promise.all([
      requestToPromise<PartialSettings | undefined>(settingsRequest),
      requestToPromise<ApiProfile[]>(apiProfilesRequest),
      requestToPromise<Assistant[]>(assistantsRequest),
      requestToPromise<Conversation[]>(conversationsRequest),
      requestToPromise<Message[]>(messagesRequest),
      requestToPromise<LocalBlobRecord[]>(blobsRequest),
    ]);
  await transactionDone(transaction);
  db.close();

  if (!settings) {
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
    blobs,
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
