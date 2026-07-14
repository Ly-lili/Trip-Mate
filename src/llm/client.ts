import OpenAI from 'openai';

export type ModelTier = 'main' | 'fast';

export interface LLMClientOptions {
  apiKey: string;
  baseURL: string;
  mainModel: string;
  fastModel: string;
}

export class LLMClient {
  readonly openai: OpenAI;
  private readonly mainModel: string;
  private readonly fastModel: string;

  constructor(opts: LLMClientOptions) {
    this.openai = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.mainModel = opts.mainModel;
    this.fastModel = opts.fastModel;
  }

  modelFor(tier: ModelTier): string {
    return tier === 'fast' ? this.fastModel : this.mainModel;
  }
}
