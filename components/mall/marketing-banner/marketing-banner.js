Component({
  properties: {
    banners: { type: Array, value: [] },
    activities: { type: Array, value: [] },
  },
  data: { current: 0 },
  observers: {
    banners() {
      this.setData({ current: 0 });
    },
  },
  methods: {
    onSlideChange(event) {
      this.setData({ current: event.detail.current });
    },
    onSelect(event) {
      const id = event.currentTarget.dataset.id;
      const banner = (this.data.banners || []).find((item) => item.id === id) || null;
      if (banner) this.triggerEvent("select", { banner });
    },
    onActivity(event) {
      const index = event.currentTarget.dataset.index;
      const activity = (this.data.activities || [])[index] || null;
      this.triggerEvent("activity", { activity });
    },
  },
});
