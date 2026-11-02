Component({
  properties: {
    // type: "loading" | "empty" | "error"
    type: { type: String, value: "loading" },
    text: { type: String, value: "" },
    subtext: { type: String, value: "" },
  },
  methods: {
    onRetry() {
      this.triggerEvent("retry");
    },
  },
});
