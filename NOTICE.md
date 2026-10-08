# Attribution

Pifrost is derived from [`lxdlam/pi-bifrost-provider`](https://github.com/lxdlam/pi-bifrost-provider), which provided the native Pi provider, Bifrost model discovery, authentication handling, OpenAI Chat Completions transport, model refresh, and model metadata mapping that form the base of this project.

The upstream project is MIT licensed. Its MIT license text is retained in `LICENSE`.

Pifrost adds routing-alias capability synthesis, conservative capability-envelope calculation, alias diagnostics, and OhMyPi-oriented configuration.

The `/pifrost doctor` concept was inspired by the diagnostics approach in [`the-matt-moo/pi-bifrost`](https://github.com/the-matt-moo/pi-bifrost); no prompt-routing implementation from that project is incorporated here.

Pifrost's image-token accounting mirrors the public compatibility rules and sizing formulas used by OhMyPi for OpenAI-, Anthropic-, and Gemini-family image inputs. Text accounting uses OhMyPi's published native tokenizer encodings through the explicitly declared `@oh-my-pi/pi-natives` runtime dependency when a candidate model exposes a tokenizer family, with the historical byte estimate retained only as a compatibility fallback. OhMyPi is MIT licensed; the mirrored image policy remains isolated and contract-tested against current OMP releases.
