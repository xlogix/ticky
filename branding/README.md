# Ticky Branding Pack

This folder contains generated branding assets for the Slack app.

## Brand direction

- Name: `Ticky`
- Tone: fast, clear, task-focused
- Primary color: `#0F172A`
- Accent cyan: `#06B6D4`
- Accent green: `#22C55E`
- Light text: `#E2E8F0`

## Source assets (editable)

- `logo/svg/icon-app.svg`: square app icon base design
- `logo/svg/icon-bot.svg`: round bot avatar icon
- `logo/svg/logo-wordmark.svg`: logo + wordmark
- `logo/svg/banner.svg`: wide header/banner graphic

## Exported assets (ready to upload/use)

- `logo/png/icon-app-512.png`: Slack app icon (recommended)
- `logo/png/icon-app-192.png`: smaller icon variant
- `logo/png/icon-bot-512.png`: bot avatar
- `logo/png/logo-wordmark-1400x420.png`: presentation/README usage
- `logo/png/banner-1600x400.png`: wide branding image

## Quick regenerate

From project root:

```bash
mkdir -p branding/logo/png
magick branding/logo/svg/icon-app.svg -resize 512x512 branding/logo/png/icon-app-512.png
magick branding/logo/svg/icon-app.svg -resize 192x192 branding/logo/png/icon-app-192.png
magick branding/logo/svg/icon-bot.svg -resize 512x512 branding/logo/png/icon-bot-512.png
magick branding/logo/svg/logo-wordmark.svg branding/logo/png/logo-wordmark-1400x420.png
magick branding/logo/svg/banner.svg branding/logo/png/banner-1600x400.png
```
