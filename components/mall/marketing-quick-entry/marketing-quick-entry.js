Component({
  properties: {
    entries: { type: Array, value: [] },
  },
  methods: {
    onTap(event) {
      const dataset = event.currentTarget.dataset;
      this.triggerEvent("entrytap", { key: dataset.key, enabled: !!dataset.enabled });
    },
  },
});
