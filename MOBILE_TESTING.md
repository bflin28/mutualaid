# 📱 Mobile Testing Quick Start

## Easiest Way (One Command!)

```bash
./start-dev.sh
```

This will:
1. Start the backend API on port 5055
2. Start the frontend on port 5173
3. Show you the URL to visit on your phone
4. Display a QR code you can scan!

Press `Ctrl+C` to stop both servers.

---

## Manual Way (More Control)

### Terminal 1 - Backend API
```bash
cd training/peft
uvicorn slack_api:app --reload --host 0.0.0.0 --port 5055
```

### Terminal 2 - Frontend
```bash
npm run dev -- --host
```

### Your Local IP
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

Your IP is: **10.0.0.29**

### Access URL
Open on your phone (same WiFi):
```
http://10.0.0.29:5173
```

---

## Tips for Quick Iteration

### 1. Keep DevTools Open
- **Chrome**: chrome://inspect → Remote devices
- **Safari**: Develop → [Your iPhone] → [Your Page]

### 2. Auto-Refresh
Changes to `.jsx`, `.css` files automatically reload on your phone!

### 3. Quick CSS Tweaks
Edit `src/App.css` and see changes instantly on mobile.

### 4. Debug Mobile Issues
```javascript
// Add this temporarily to debug
console.log('Mobile test:', window.innerWidth)
alert('Quick check: ' + someValue)
```

### 5. Test Different Screen Sizes
- **iPhone SE**: 375px wide
- **iPhone 14**: 390px wide
- **iPhone 14 Pro Max**: 430px wide

Use Chrome DevTools → Toggle device toolbar to simulate!

---

## Troubleshooting

### Can't connect from phone?

1. **Same WiFi?** Phone and computer must be on same network
2. **Firewall?** System Preferences → Security → Firewall → allow incoming
3. **VPN?** Disable VPN if active
4. **Try localhost** If above fails, use: `http://localhost:5173` (only works on same device)

### Backend not working?

Check if Python backend is running:
```bash
curl http://localhost:5055/health
```

Should return: `{"status":"ok","total":XXX}`

### Frontend won't start?

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run dev -- --host
```

---

## Making Changes

The logging form is in: `src/App.jsx` around line **2040-2200**

Mobile styles are in: `src/App.css` around line **967-1171**

**Hot reload works!** Save your file and your phone updates automatically.

---

## Common Mobile CSS Tweaks

```css
/* Make form inputs bigger for mobile */
@media (max-width: 640px) {
  .logging-form input,
  .logging-form select {
    font-size: 16px;  /* Prevents zoom on iOS */
    padding: 1rem;    /* Bigger touch targets */
  }
}
```

Happy testing! 🚀
