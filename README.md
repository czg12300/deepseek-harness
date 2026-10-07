# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

On macOS or Linux, run [`./startup.sh`](startup.sh) from the checkout for dependency checks, installation, compilation, and Web startup in one command. Install Node.js 22.19+ (22.x) or 24+ with development headers, Python 3, make, and a C/C++ compiler first; the script reports missing tools and obtains the pinned pnpm through Corepack or npx when needed. Open the complete authenticated URL printed after startup and keep the terminal open; Ctrl+C stops the server. Use `./startup.sh --port 8080` to select a port or add `--no-open` to skip browser opening.

The script defaults to the checkout's gitignored `.dsh-local/` for profiles, settings, and history, isolating it from desktop applications using `~/.dsh`. Set `DSH_HOME` explicitly to reuse another data directory. The startup output identifies both the source checkout and data directory.

Before installing dependencies, the launcher checks proxy configuration in this order: the launching environment, the current `$DSH_HOME/.env`, `~/.dsh/.env`, then macOS static HTTP proxy settings. It checks proxy-listener reachability, exports the selected settings for this run, and keeps localhost callbacks direct without rewriting either `.env`. Invalid or unreachable explicit settings stop startup; an unavailable shared-home proxy can fall back to the system proxy. Use `./startup.sh --check-network` to inspect this without building or launching, or `DSH_STARTUP_PROXY=direct ./startup.sh` to choose direct networking explicitly. `DSH_STARTUP_PROXY_TIMEOUT_MS` sets the per-listener timeout in milliseconds (default 3000). This check verifies the proxy listener, not provider availability or account authorization.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
