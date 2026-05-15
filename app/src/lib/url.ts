// URL builders for external services we link to from the briefing.

export function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function appleMapsUrl(query: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
}

/** Google Maps directions search for "nearest hospital to X". */
export function nearestHospitalUrl(addressNearby: string): string {
  return `https://www.google.com/maps/search/hospital+near+${encodeURIComponent(addressNearby)}`;
}
