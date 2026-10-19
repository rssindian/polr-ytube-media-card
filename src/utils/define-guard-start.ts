// Bundled Material elements (mwc-*, md-*) may already be registered by Home
// Assistant (older versions) or not at all (newer versions). Make duplicate
// registrations harmless while this bundle loads. Restored by define-guard-end.
const original = customElements.define.bind(customElements);
(window as any).__polrOriginalDefine = original;
customElements.define = function (name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions) {
    if (customElements.get(name)) return;
    original(name, ctor, options);
} as typeof customElements.define;
export {};
