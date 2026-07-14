import 'dotenv/config';

export const config = {
  get deepseekApiKey(): string {
    const v = process.env.DEEPSEEK_API_KEY;
    if (!v) {
      throw new Error('DEEPSEEK_API_KEY is required (export it or copy .env.example to .env)');
    }
    return v;
  },
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  mainModel: process.env.MAIN_MODEL ?? 'deepseek-v4-pro',
  fastModel: process.env.FAST_MODEL ?? 'deepseek-v4-flash',
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
};
