export const VidalProvider = {
  id: "vidal",
  mode: "awaiting_license",
  license_status: "awaiting_license",
  async searchDrugs({ query, extended = false }) {
    return [];
  },
};
