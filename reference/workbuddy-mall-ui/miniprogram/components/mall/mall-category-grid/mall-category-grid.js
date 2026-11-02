Component({
  properties: {
    categories: { type: Array, value: [] },
  },
  methods: {
    onSelect(event) {
      const dataset = event.currentTarget.dataset;
      this.triggerEvent("select", { id: dataset.id, name: dataset.name });
    },
  },
});
