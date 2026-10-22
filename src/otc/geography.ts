import directory from './cities.json';
export type OtcCity = { id: string; name: string; timezone: string };
export const OTC_CITIES = directory as Record<string, OtcCity[]>;
export function cityFor(country: string, id: string): OtcCity | undefined {
  return Object.prototype.hasOwnProperty.call(OTC_CITIES, country) ? OTC_CITIES[country].find(city => city.id === id) : undefined;
}
