// Storage and transport are injected: browser, native, or test implementations can own them.
export function validSchedule(value, selected) {
  return value?.meta?.landing?.displayName && value.routes && Array.isArray(value.calendars) && Array.isArray(value.departures)
    && (selected === null || value.meta.landingNumber === selected);
}

export function createScheduleStore({ storage, prefix }) {
  return {
    read(landingNumber) {
      const value = storage.json(`${prefix}-landing-${landingNumber}`);
      return validSchedule(value, landingNumber) ? value : null;
    },
    write(payload) {
      storage.setItem(`${prefix}-landing-${payload.meta.landingNumber}`, JSON.stringify(payload));
    }
  };
}
