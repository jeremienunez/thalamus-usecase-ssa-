import { type ThalamusTransportConfig } from "@interview/shared/config";
import {
  getThalamusTransportConfig,
  getThalamusTransportConfigSnapshot,
} from "./transport-config";

export interface KimiConfig {
  url: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  maxRetries: number;
}

export interface OpenAIFallbackConfig {
  openaiApiKey: string;
  model: string;
}

export interface LocalLlmConfig {
  url: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface MiniMaxConfig {
  url: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface DeepSeekConfig {
  url: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

function toKimiConfig(cfg: ThalamusTransportConfig): KimiConfig {
  return {
    url: cfg.kimiApiUrl,
    apiKey: cfg.kimiApiKey,
    model: cfg.kimiModel,
    maxTokens: cfg.kimiMaxTokens,
    maxRetries: cfg.llmMaxRetries,
  };
}

function toOpenAIFallbackConfig(
  cfg: ThalamusTransportConfig,
): OpenAIFallbackConfig {
  return {
    openaiApiKey: cfg.openaiApiKey,
    model: cfg.openaiFallbackModel,
  };
}

function toLocalLlmConfig(cfg: ThalamusTransportConfig): LocalLlmConfig {
  return {
    url: cfg.localLlmUrl,
    model: cfg.localLlmModel,
    maxTokens: cfg.localLlmMaxTokens,
    temperature: cfg.localLlmTemperature,
  };
}

function toMiniMaxConfig(cfg: ThalamusTransportConfig): MiniMaxConfig {
  return {
    url: cfg.minimaxApiUrl,
    apiKey: cfg.minimaxApiKey,
    model: cfg.minimaxModel,
    maxTokens: cfg.minimaxMaxTokens,
  };
}

function toDeepSeekConfig(cfg: ThalamusTransportConfig): DeepSeekConfig {
  return {
    url: cfg.deepseekApiUrl,
    apiKey: cfg.deepseekApiKey,
    model: cfg.deepseekModel,
    maxTokens: cfg.deepseekMaxTokens,
  };
}

export async function getEnrichmentConfig(): Promise<KimiConfig> {
  return toKimiConfig(await getThalamusTransportConfig());
}

export function getEnrichmentConfigSnapshot(): KimiConfig {
  return toKimiConfig(getThalamusTransportConfigSnapshot());
}

export async function getEnrichmentFallbackConfig(): Promise<OpenAIFallbackConfig> {
  return toOpenAIFallbackConfig(await getThalamusTransportConfig());
}

export function getEnrichmentFallbackConfigSnapshot(): OpenAIFallbackConfig {
  return toOpenAIFallbackConfig(getThalamusTransportConfigSnapshot());
}

export const isKimiEnabled = (): boolean =>
  Boolean(getEnrichmentConfigSnapshot().apiKey);

export async function getLocalLlmConfig(): Promise<LocalLlmConfig> {
  return toLocalLlmConfig(await getThalamusTransportConfig());
}

export function getLocalLlmConfigSnapshot(): LocalLlmConfig {
  return toLocalLlmConfig(getThalamusTransportConfigSnapshot());
}

export const isLocalLlmEnabled = (): boolean =>
  Boolean(getLocalLlmConfigSnapshot().url);

export async function getMinimaxConfig(): Promise<MiniMaxConfig> {
  return toMiniMaxConfig(await getThalamusTransportConfig());
}

export function getMinimaxConfigSnapshot(): MiniMaxConfig {
  return toMiniMaxConfig(getThalamusTransportConfigSnapshot());
}

export const isMinimaxEnabled = (): boolean =>
  Boolean(getMinimaxConfigSnapshot().apiKey);

export async function getDeepSeekConfig(): Promise<DeepSeekConfig> {
  return toDeepSeekConfig(await getThalamusTransportConfig());
}

export function getDeepSeekConfigSnapshot(): DeepSeekConfig {
  return toDeepSeekConfig(getThalamusTransportConfigSnapshot());
}

export const isDeepSeekEnabled = (): boolean =>
  Boolean(getDeepSeekConfigSnapshot().apiKey);
