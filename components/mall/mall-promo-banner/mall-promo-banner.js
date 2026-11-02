Component({
  properties: {
    banners: { type: Array, value: [] },
    activities: { type: Array, value: [] },
  },
  methods: {
    onSelect(event) {
      const id = event.currentTarget.dataset.id;
      const banner = (this.data.banners || []).find((item) => item.id === id) || null;
      this.triggerEvent("select", { banner });
    },
    onActivity(event) {
      const index = event.currentTarget.dataset.index;
      const activity = (this.data.activities || [])[index] || null;
      this.triggerEvent("activity", { activity });
    },
  },
});
