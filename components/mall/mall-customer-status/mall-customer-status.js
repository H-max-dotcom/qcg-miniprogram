Component({
  properties: {
    view: {
      type: Object,
      value: { tone: "guest", icon: "◐", title: "", desc: "", cta: "" },
    },
  },
  methods: {
    onAction() {
      this.triggerEvent("action");
    },
  },
});
