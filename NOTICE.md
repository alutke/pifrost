# Attribution

Pifrost is derived from [`lxdlam/pi-bifrost-provider`](https://github.com/lxdlam/pi-bifrost-provider), which provided the native Pi provider, Bifrost model discovery, authentication handling, OpenAI Chat Completions transport, model refresh, and model metadata mapping that form the base of this project.

The upstream project is MIT licensed. Its MIT license text is retained in `LICENSE`.

Pifrost adds routing-alias capability synthesis, conservative capability-envelope calculation, alias diagnostics, and OhMyPi-oriented configuration.

The `/pifrost doctor` concept was inspired by the diagnostics approach in [`the-matt-moo/pi-bifrost`](https://github.com/the-matt-moo/pi-bifrost); no prompt-routing implementation from that project is incorporated here.
