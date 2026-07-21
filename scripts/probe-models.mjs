#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_TOKENS = 4;
const DEFAULT_PROMPT = "ping";
const PROTOCOLS = ["responses", "chat"];

const usage = `
Probe OpenAI-compatible model availability with bounded parallel requests.

Usage:
  node scripts/probe-models.mjs --base-url https://api.example.com/v1 --models-file models.txt
  node scripts/probe-models.mjs --base-url https://api.example.com --rules-file model-probe-rules/mainstream.json --group gemini

Required:
  --base-url <url>              Gateway base URL. /v1 is optional in auto route mode.
  --api-key <key>               API key. Prefer env MOBILECHAT_PROBE_API_KEY / OPENAI_API_KEY.
  --models <a,b,c>              Candidate model IDs, comma or newline separated.
  --models-file <path>          Candidate model IDs, one per line. # comments allowed.
  --rules-file <path>           Probe rule manifest. Can be repeated.
  --group <id>                  Probe only selected rule group(s). Can be repeated.

Options:
  --protocol <auto|both|responses|chat>
                                auto/both probe Responses and Chat Completions. Default: auto.
  --route-mode <auto|as-is|append-v1>
                                auto tries /v1 and as-is when base URL has no /v1. Default: auto.
  --concurrency <n>             Parallel probe limit. Default: ${DEFAULT_CONCURRENCY}.
  --timeout-ms <n>              Per-request timeout. Default: ${DEFAULT_TIMEOUT_MS}.
  --max-tokens <n>              Minimal output token cap. Default: ${DEFAULT_MAX_TOKENS}.
  --prompt <text>               Probe prompt. Default: ${DEFAULT_PROMPT}.
  --list-models / --no-list-models
                                Try GET /models before probes. Default: on.
  --include-listed              Add IDs returned by GET /models to candidate probes.
  --output <path>               Write JSON report.
  --markdown <path>             Write Markdown report.
  --help                        Show this help.

Notes:
  - Success means the concrete model/protocol/endpoint accepted a minimal text request.
  - /models is advisory only; many gateways do not expose it or expose stale names.
  - This script intentionally does not probe web search or multimodal by default.
`;

const nowIso = () => new Date().toISOString();

const isFlag = (value) => typeof value === "string" && value.startsWith("--");

const parseArgs = (argv) => {
  const args = {
    protocol: "auto",
    routeMode: "auto",
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxTokens: DEFAULT_MAX_TOKENS,
    prompt: DEFAULT_PROMPT,
    listModels: true,
    includeListed: false,
    headers: [],
    rulesFiles: [],
    ruleGroups: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    const readValue = () => {
      if (next === undefined || isFlag(next)) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return next;
    };

    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--base-url":
        args.baseUrl = readValue();
        break;
      case "--api-key":
        args.apiKey = readValue();
        break;
      case "--models":
        args.models = `${args.models ? `${args.models}\n` : ""}${readValue()}`;
        break;
      case "--models-file":
        args.modelsFile = readValue();
        break;
      case "--rules-file":
        args.rulesFiles.push(readValue());
        break;
      case "--group":
        args.ruleGroups.push(readValue());
        break;
      case "--protocol":
        args.protocol = readValue();
        break;
      case "--route-mode":
        args.routeMode = readValue();
        break;
      case "--concurrency":
        args.concurrency = Number(readValue());
        break;
      case "--timeout-ms":
        args.timeoutMs = Number(readValue());
        break;
      case "--max-tokens":
        args.maxTokens = Number(readValue());
        break;
      case "--prompt":
        args.prompt = readValue();
        break;
      case "--list-models":
        args.listModels = true;
        break;
      case "--no-list-models":
        args.listModels = false;
        break;
      case "--include-listed":
        args.includeListed = true;
        break;
      case "--output":
        args.output = readValue();
        break;
      case "--markdown":
        args.markdown = readValue();
        break;
      case "--header":
        args.headers.push(readValue());
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
};

const normalizeBaseUrl = (baseUrl) => {
  const trimmed = String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Base URL is required.");
  }
  return trimmed;
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const MODEL_NAME_TEMPLATE_KEY = "modelName";
const MODEL_NAME_TEMPLATE_TOKEN = "{modelName}";

const createRouteBases = (baseUrl, routeMode) => {
  const normalized = normalizeBaseUrl(baseUrl);
  const withoutTrailingV1 = normalized.replace(/\/v1$/i, "");
  const hasV1 = /\/v1$/i.test(normalized);

  if (routeMode === "as-is") {
    return [normalized];
  }
  if (routeMode === "append-v1") {
    return [hasV1 ? normalized : `${normalized}/v1`];
  }
  if (routeMode !== "auto") {
    throw new Error("--route-mode must be auto, as-is, or append-v1.");
  }

  return hasV1 ? [normalized] : unique([`${withoutTrailingV1}/v1`, normalized]);
};

const createProtocolList = (protocol) => {
  if (protocol === "auto" || protocol === "both") {
    return PROTOCOLS;
  }
  if (protocol === "responses") {
    return ["responses"];
  }
  if (protocol === "chat") {
    return ["chat"];
  }
  throw new Error("--protocol must be auto, both, responses, or chat.");
};

const parseHeader = (header) => {
  const separator = header.indexOf(":");
  if (separator <= 0) {
    throw new Error(`Invalid --header value: ${header}`);
  }
  return [
    header.slice(0, separator).trim(),
    header.slice(separator + 1).trim(),
  ];
};

const createHeaders = (apiKey, customHeaders) => {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  for (const header of customHeaders) {
    const [key, value] = parseHeader(header);
    headers[key] = value;
  }
  return headers;
};

const parseModelsText = (text) => {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const values = Array.isArray(parsed) ? parsed : parsed.models;
    if (!Array.isArray(values)) {
      throw new Error("JSON model list must be an array or { models: [...] }.");
    }
    return values
      .map((value) =>
        typeof value === "string" ? value : (value?.id ?? value?.model),
      )
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  }

  return trimmed
    .split(/[\n,]/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .flatMap((line) => line.split(/\s+/))
    .map((value) => value.trim())
    .filter(Boolean);
};

const toInteger = (value, fallback) => {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) ? number : fallback;
};

const clampMinor = (value) => Math.max(0, Math.min(9, value));

const expandMinorTenths = (config) => {
  const majors = Array.isArray(config.majors)
    ? config.majors
    : Array.isArray(config.major)
      ? config.major
      : [config.major];
  const from = clampMinor(toInteger(config.from, 0));
  const to = clampMinor(toInteger(config.to, 9));
  const separator = config.separator === "-" ? "-" : ".";
  const [start, end] = from <= to ? [from, to] : [to, from];

  return majors.flatMap((major) => {
    const prefix = String(major ?? "").trim();
    if (!prefix) {
      return [];
    }
    return Array.from({ length: end - start + 1 }, (_, index) => {
      const minor = start + index;
      return minor === 0 ? prefix : `${prefix}${separator}${minor}`;
    });
  });
};

const expandDimensionValues = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap(expandDimensionValues);
  }

  if (value && typeof value === "object") {
    if (value.type === "minorTenths" || value.minorTenths === true) {
      return expandMinorTenths(value);
    }
    if (Array.isArray(value.values)) {
      return value.values.flatMap(expandDimensionValues);
    }
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [String(value).trim()];
};

const normalizeDimensions = (dimensions = {}) =>
  Object.entries(dimensions).map(([key, value]) => [
    key,
    expandDimensionValues(value),
  ]);

const cartesian = (entries) =>
  entries.reduce(
    (rows, [key, values]) =>
      rows.flatMap((row) =>
        values.map((value) => ({
          ...row,
          [key]: String(value),
        })),
      ),
    [{}],
  );

const formatTemplateValue = (key, value) => {
  if (!/^arg\d+$/.test(key)) {
    return value;
  }

  const normalized = String(value ?? "")
    .trim()
    .replace(/^-+/, "");
  return normalized ? `-${normalized}` : "";
};

const syncTemplateModelName = (template, modelName) => {
  const normalizedTemplate = String(template ?? "").trim();
  if (!normalizedTemplate) {
    return `${MODEL_NAME_TEMPLATE_TOKEN}-{version}{arg1}`;
  }
  if (normalizedTemplate.includes(MODEL_NAME_TEMPLATE_TOKEN)) {
    return normalizedTemplate;
  }

  const normalizedModelName = String(modelName ?? "").trim();
  if (!normalizedModelName) {
    return normalizedTemplate;
  }

  return normalizedTemplate.replace(
    new RegExp(
      `^${normalizedModelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[-{])`,
    ),
    MODEL_NAME_TEMPLATE_TOKEN,
  );
};

const expandTemplate = (template, dimensions = {}, modelName = "") =>
  cartesian([
    [MODEL_NAME_TEMPLATE_KEY, [String(modelName ?? "").trim()]],
    ...normalizeDimensions(dimensions),
  ]).map((values) =>
    Object.entries(values).reduce(
      (text, [key, value]) =>
        text.replaceAll(`{${key}}`, formatTemplateValue(key, value)),
      template,
    ),
  );

const expandRuleGroup = (group) => {
  const explicit = Array.isArray(group.models) ? group.models : [];
  const rules = Array.isArray(group.rules) ? group.rules : [];
  const generated = rules.flatMap((rule) =>
    expandTemplate(
      syncTemplateModelName(rule.template, group.id),
      rule.dimensions,
      group.id,
    ),
  );
  return unique(
    [...explicit, ...generated].map((model) => String(model ?? "").trim()),
  );
};

const readRuleModels = async (rulesFiles, selectedGroups) => {
  if (rulesFiles.length === 0) {
    return [];
  }

  const selected = new Set(selectedGroups);
  const knownGroupIds = new Set();
  const models = [];

  for (const rulesFile of rulesFiles) {
    const manifest = JSON.parse(await readFile(rulesFile, "utf8"));
    const excluded = new Set(manifest.globalExclude ?? []);
    const groups = Array.isArray(manifest.groups) ? manifest.groups : [];
    for (const group of groups) {
      knownGroupIds.add(group.id);
      if (selected.size > 0 && !selected.has(group.id)) {
        continue;
      }
      models.push(
        ...expandRuleGroup(group).filter((model) => !excluded.has(model)),
      );
    }
  }

  const unknownGroups = [...selected].filter(
    (groupId) => !knownGroupIds.has(groupId),
  );
  if (unknownGroups.length > 0) {
    throw new Error(`Unknown rule group(s): ${unknownGroups.join(", ")}`);
  }

  return unique(models);
};

const readCandidateModels = async (args) => {
  const inlineModels = parseModelsText(args.models);
  const fileModels = args.modelsFile
    ? parseModelsText(await readFile(args.modelsFile, "utf8"))
    : [];
  const ruleModels = await readRuleModels(args.rulesFiles, args.ruleGroups);
  return unique([...inlineModels, ...fileModels, ...ruleModels]);
};

const requestJson = async ({
  url,
  method = "GET",
  headers,
  body,
  timeoutMs,
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const text = await response.text().catch(() => "");
    let json = undefined;
    if (text.trim()) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      latencyMs,
      text,
      json,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      ok: false,
      status: 0,
      statusText: error?.name === "AbortError" ? "timeout" : "network_error",
      latencyMs,
      text: error instanceof Error ? error.message : String(error),
      json: undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const listGatewayModels = async ({ routeBases, headers, timeoutMs }) => {
  const attempts = [];
  for (const routeBase of routeBases) {
    const url = `${routeBase}/models`;
    const result = await requestJson({ url, headers, timeoutMs });
    const ids = Array.isArray(result.json?.data)
      ? result.json.data
          .map((item) => item?.id ?? item?.model)
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      : [];
    attempts.push({
      routeBase,
      url,
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      latencyMs: result.latencyMs,
      count: ids.length,
      ids,
      error: result.ok ? undefined : compactError(result),
    });
  }
  return attempts;
};

const createProbeBody = ({ model, protocol, prompt, maxTokens }) => {
  if (protocol === "responses") {
    return JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: maxTokens,
      store: false,
    });
  }

  return JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature: 0,
  });
};

const endpointForProtocol = (routeBase, protocol) =>
  `${routeBase}${protocol === "responses" ? "/responses" : "/chat/completions"}`;

const readUsage = (json) =>
  json?.usage ?? json?.response?.usage ?? json?.data?.usage ?? undefined;

const compactError = (result) => {
  const jsonError = result.json?.error ?? result.json;
  if (jsonError && typeof jsonError === "object") {
    const message =
      jsonError.message ??
      jsonError.error?.message ??
      jsonError.detail ??
      result.statusText;
    const code = jsonError.code ?? jsonError.error?.code;
    const type = jsonError.type ?? jsonError.error?.type;
    return [message, type ? `type=${type}` : "", code ? `code=${code}` : ""]
      .filter(Boolean)
      .join("; ");
  }
  return result.text?.slice(0, 240) || result.statusText || "request failed";
};

const probeOne = async ({
  model,
  protocol,
  routeBase,
  headers,
  timeoutMs,
  prompt,
  maxTokens,
}) => {
  const url = endpointForProtocol(routeBase, protocol);
  const result = await requestJson({
    url,
    method: "POST",
    headers,
    body: createProbeBody({ model, protocol, prompt, maxTokens }),
    timeoutMs,
  });

  return {
    model,
    protocol,
    routeBase,
    url,
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    latencyMs: result.latencyMs,
    usage: readUsage(result.json),
    providerResponseId: result.json?.id,
    error: result.ok ? undefined : compactError(result),
  };
};

const runPool = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );

  await Promise.all(workers);
  return results;
};

const statusRank = (attempt) => {
  if (attempt.ok) {
    return 0;
  }
  if (attempt.status === 401 || attempt.status === 403) {
    return 3;
  }
  if (attempt.status === 404) {
    return 2;
  }
  return 1;
};

const aggregateResults = ({ models, attempts }) =>
  models.map((model) => {
    const modelAttempts = attempts
      .filter((attempt) => attempt.model === model)
      .sort((left, right) => {
        const rank = statusRank(left) - statusRank(right);
        return rank || left.latencyMs - right.latencyMs;
      });
    const successes = modelAttempts.filter((attempt) => attempt.ok);
    const best = successes[0] ?? modelAttempts[0];
    const supportedProtocols = unique(
      successes.map((attempt) => attempt.protocol),
    );

    return {
      model,
      ok: successes.length > 0,
      bestProtocol: successes[0]?.protocol,
      bestRouteBase: successes[0]?.routeBase,
      bestLatencyMs: successes[0]?.latencyMs,
      supportedProtocols,
      attempts: modelAttempts,
      summary: best?.ok
        ? `${successes[0].protocol} ${successes[0].latencyMs}ms`
        : best
          ? `HTTP ${best.status || "ERR"} ${best.error ?? best.statusText}`
          : "not probed",
    };
  });

const formatConsoleReport = ({ aggregated, listModels }) => {
  const lines = [];
  lines.push("Model probe result:");
  lines.push("");

  const modelWidth = Math.min(
    42,
    Math.max(5, ...aggregated.map((item) => item.model.length)),
  );
  const protocolWidth = 15;
  lines.push(
    `${"model".padEnd(modelWidth)}  ${"ok".padEnd(3)}  ${"protocols".padEnd(
      protocolWidth,
    )}  best / error`,
  );
  lines.push(
    `${"-".repeat(modelWidth)}  ---  ${"-".repeat(protocolWidth)}  ------------`,
  );

  for (const item of aggregated) {
    const modelText =
      item.model.length > modelWidth
        ? `${item.model.slice(0, modelWidth - 1)}…`
        : item.model;
    lines.push(
      `${modelText.padEnd(modelWidth)}  ${
        item.ok ? "yes" : "no ".padEnd(3)
      }  ${(item.supportedProtocols.join(",") || "-").padEnd(
        protocolWidth,
      )}  ${item.summary}`,
    );
  }

  if (listModels.length > 0) {
    lines.push("");
    lines.push("GET /models attempts:");
    for (const attempt of listModels) {
      lines.push(
        `- ${attempt.url}: ${
          attempt.ok
            ? `ok, ${attempt.count} ids, ${attempt.latencyMs}ms`
            : `HTTP ${attempt.status || "ERR"} ${attempt.error}`
        }`,
      );
    }
  }

  return lines.join("\n");
};

const formatMarkdownReport = ({ report }) => {
  const lines = [
    "# MobileChat model probe report",
    "",
    `- Created: ${report.createdAt}`,
    `- Base URL: ${report.baseUrl}`,
    `- Route bases: ${report.routeBases.join(", ")}`,
    `- Protocols: ${report.protocols.join(", ")}`,
    `- Concurrency: ${report.options.concurrency}`,
    "",
    "## Summary",
    "",
    "| Model | OK | Protocols | Best / Error |",
    "| --- | --- | --- | --- |",
  ];

  for (const item of report.results) {
    lines.push(
      `| \`${item.model.replaceAll("|", "\\|")}\` | ${
        item.ok ? "yes" : "no"
      } | ${item.supportedProtocols.join(", ") || "-"} | ${item.summary.replaceAll(
        "|",
        "\\|",
      )} |`,
    );
  }

  lines.push("", "## GET /models", "");
  if (report.listModels.length === 0) {
    lines.push("Not requested.");
  } else {
    for (const attempt of report.listModels) {
      lines.push(
        `- \`${attempt.url}\`: ${
          attempt.ok
            ? `ok, ${attempt.count} ids, ${attempt.latencyMs}ms`
            : `HTTP ${attempt.status || "ERR"} ${attempt.error}`
        }`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

const ensureParentDir = async (filePath) => {
  const dir = path.dirname(filePath);
  if (dir && dir !== ".") {
    await mkdir(dir, { recursive: true });
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage.trim());
    return;
  }

  const baseUrl = args.baseUrl ?? process.env.MOBILECHAT_PROBE_BASE_URL;
  const apiKey =
    args.apiKey ??
    process.env.MOBILECHAT_PROBE_API_KEY ??
    process.env.MNAPI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.API_KEY;

  if (!baseUrl) {
    throw new Error("--base-url is required.");
  }
  if (!apiKey) {
    throw new Error(
      "--api-key is required, or set MOBILECHAT_PROBE_API_KEY / OPENAI_API_KEY.",
    );
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be at least 1000.");
  }

  const routeBases = createRouteBases(baseUrl, args.routeMode);
  const protocols = createProtocolList(args.protocol);
  const headers = createHeaders(apiKey, args.headers);
  const listModels = args.listModels
    ? await listGatewayModels({
        routeBases,
        headers,
        timeoutMs: args.timeoutMs,
      })
    : [];
  const listedModels = unique(listModels.flatMap((attempt) => attempt.ids));
  const candidateModels = unique([
    ...(await readCandidateModels(args)),
    ...(args.includeListed ? listedModels : []),
  ]);

  if (candidateModels.length === 0) {
    throw new Error(
      "No candidate models. Use --models, --models-file, --rules-file, or --include-listed when GET /models succeeds.",
    );
  }

  const tasks = candidateModels.flatMap((model) =>
    routeBases.flatMap((routeBase) =>
      protocols.map((protocol) => ({ model, routeBase, protocol })),
    ),
  );

  console.log(
    `Probing ${candidateModels.length} models, ${protocols.length} protocols, ${routeBases.length} route base(s), concurrency=${args.concurrency}...`,
  );

  const attempts = await runPool(tasks, args.concurrency, (task) =>
    probeOne({
      ...task,
      headers,
      timeoutMs: args.timeoutMs,
      prompt: args.prompt,
      maxTokens: args.maxTokens,
    }),
  );

  const report = {
    createdAt: nowIso(),
    baseUrl: normalizeBaseUrl(baseUrl),
    routeBases,
    protocols,
    options: {
      protocol: args.protocol,
      routeMode: args.routeMode,
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
      maxTokens: args.maxTokens,
      prompt: args.prompt,
      listModels: args.listModels,
      includeListed: args.includeListed,
      rulesFiles: args.rulesFiles,
      ruleGroups: args.ruleGroups,
    },
    listModels,
    candidateModels,
    results: aggregateResults({ models: candidateModels, attempts }),
    attempts,
  };

  console.log(formatConsoleReport({ aggregated: report.results, listModels }));

  if (args.output) {
    await ensureParentDir(args.output);
    await writeFile(
      args.output,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    console.error(`Wrote JSON report: ${args.output}`);
  }
  if (args.markdown) {
    await ensureParentDir(args.markdown);
    await writeFile(args.markdown, formatMarkdownReport({ report }), "utf8");
    console.error(`Wrote Markdown report: ${args.markdown}`);
  }

  const successCount = report.results.filter((item) => item.ok).length;
  if (successCount === 0) {
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
