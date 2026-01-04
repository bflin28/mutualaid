# Local Development for Mobile Testing

## Quick Start

### 1. Start the Backend API (Terminal 1)
```bash
cd /Users/benlin/prodprojects/mutualaid
cd training/peft
uvicorn slack_api:app --reload --host 0.0.0.0 --port 5055
```

This starts the Python backend on port 5055, accessible from your local network.

### 2. Start the Frontend (Terminal 2)
```bash
cd /Users/benlin/prodprojects/mutualaid
npm run dev -- --host
```

This starts Vite dev server on port 5173, accessible from your local network.

### 3. Find Your Local IP Address
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

Look for something like: `inet 192.168.1.XXX` or `inet 10.0.0.XXX`

### 4. Access on Your Phone

Make sure your phone is on the **same WiFi network** as your computer.

Open on your phone:
```
http://YOUR_IP_ADDRESS:5173
```

Example: `http://192.168.1.100:5173`

## Alternative: Use QR Code

After starting the dev server, Vite will show a QR code in the terminal that you can scan with your phone!

## Troubleshooting

### Can't access from phone?
1. **Check firewall**: Make sure your Mac allows incoming connections on ports 5055 and 5173
   ```bash
   # Allow ports through firewall (if needed)
   # Go to System Preferences > Security & Privacy > Firewall > Firewall Options
   ```

2. **Same network**: Ensure your phone and computer are on the same WiFi

3. **Use ngrok** (if above doesn't work):
   ```bash
   # Install ngrok
   brew install ngrok

   # In Terminal 3, tunnel the frontend
   ngrok http 5173
   ```

   Ngrok will give you a public URL you can access from anywhere!

## Tips for Mobile Testing

- **Chrome DevTools**: On desktop Chrome, open DevTools > More tools > Remote devices to debug your phone
- **Safari**: On Mac, enable Develop menu > [Your iPhone] to inspect mobile Safari
- **Hot reload**: Changes to your code will automatically refresh on your phone!
- **Console logs**: Use `alert()` or inspect with remote DevTools to see logs

## Environment Variables

If you need to configure API endpoints, create `.env.local`:
```bash
VITE_SLACK_BROWSER_API=http://YOUR_IP:5055
```

Then restart the dev server.
