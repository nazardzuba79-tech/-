export type ServiceGroup = 'work' | 'entertainment' | 'markets';

export interface ServiceItem {
  name: string;
  group: ServiceGroup;
  mark: 'chatgpt' | 'claude' | 'netflix' | 'spotify' | 'apple' | 'youtube' | 'tradingview' | 'ft';
}

export const services: ServiceItem[] = [
{ name: 'ChatGPT', group: 'work', mark: 'chatgpt' },
{ name: 'Claude', group: 'work', mark: 'claude' },
{ name: 'Netflix', group: 'entertainment', mark: 'netflix' },
{ name: 'Spotify', group: 'entertainment', mark: 'spotify' },
{ name: 'Apple Music', group: 'entertainment', mark: 'apple' },
{ name: 'YouTube Premium', group: 'entertainment', mark: 'youtube' },
{ name: 'TradingView', group: 'markets', mark: 'tradingview' },
{ name: 'Financial Times', group: 'markets', mark: 'ft' }];
