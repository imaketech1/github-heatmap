
# github-heatmap

<p align="center">
  <img src="https://raw.githubusercontent.com/imaketech1/github-heatmap/output/heatmap.gif" alt="GitHub Heatmap" width="800">
</p>

> *Animated web-dollz gracing your GitHub contribution heatmap!*

## Watch web-dollz stroll across your contribution grid!

```bash
git clone https://github.com/imaketech1/github-heatmap
cd github-heatmap
npm install
```
## Assets

The included webdollz GIF assets (`nm263.gif` and `e109.gif`) are sourced from the web and are not owned or created by me.
You are encouraged to replace them with your own assets.

## Fork and Customize

1. **Fork this repository** (click the Fork button top right)

2. **Clone your fork**

3. **Update your username** in `config.json`
   ```json
   {
     "username": "your-github-username"
   }
   ```

4. **Commit and push**

5. **Enable GitHub Actions**
   - Go to your fork on GitHub
   - Click Actions tab
   - Enable workflows

The action will run daily and generate your heatmap GIF.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run generate` | Generate SVG heatmap |
| `npm run gif` | Convert SVG to GIF |
| `npm run build` | Run both |

## How It Works

- Fetches your GitHub contribution data
- Simulates a character walking across your heatmap
- Generates an SVG animation
- Converts to GIF (via Puppeteer + FFmpeg)
- Deploys to the `output` branch



## Requirements

- Node.js 18+
- FFmpeg (for GIF conversion)
- Chromium (for Puppeteer)

## License
MIT

## Contributing

Contributions are welcome! Feel free to:
- Open an issue for bugs or feature requests
- Submit a pull request with improvements
- Fork and customize for your own use