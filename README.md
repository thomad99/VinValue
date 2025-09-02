# VINValue

Web app that opens a headless browser to fetch a valuation from `webuyanycarusa.com` using VIN and mileage. The automation follows the steps described in `details.txt`.

## Prerequisites

- Node.js 18+

## Setup

```bash
npm install
```

This will also install the Chromium browser for Playwright.

## Run

```bash
npm start
```

Open `http://localhost:3000` and enter VIN and mileage.

Optional fields:
- Zip: defaults to `WEBUYZIPCODE` env var (fallback `34238`)
- Email: defaults to `WEBUYEMAIL` env var (fallback `Thomad99@gmail.com`)

## Notes

- This project automates a third-party site. Selectors may change; if valuation is not found, adjust selectors in `server.js`.
- Use responsibly and per the website's Terms of Service.


