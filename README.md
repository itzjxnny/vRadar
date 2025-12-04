# vRadar - VALORANT Player Tracker

A real-time VALORANT player statistics tracker that displays live match data, player ranks, stats, and more.

## Features

- **Live Match Tracking**: View real-time player statistics during matches (pregame, in-game, and menus)
- **Player Profiles**: Detailed overview of player statistics including rank, KD, headshot percentage, win rate, and more
- **Match History**: Browse past competitive matches with filtering by agent and map
- **Rank Display**: Visual rank badges and tier information
- **Competitive Stats**: Focus on competitive match statistics for accurate player analysis
- **Customizable UI**: Modern, responsive interface with customizable settings

## Requirements

- Node.js (v18 or higher recommended)
- npm or yarn
- VALORANT client installed and running
- Windows OS (currently optimized for Windows)

## Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Run the application:
```bash
npm start
```

## Development

For development with hot-reload:
```bash
npm run dev
```

This will start both the Electron main process watcher and the React development server concurrently.

### Available Scripts

- `npm run dev` - Start development mode with hot-reload
- `npm run build` - Build both Electron and React applications
- `npm run build:electron` - Build only the Electron main process
- `npm run build:react` - Build only the React frontend
- `npm start` - Run the built application
- `npm run package` - Build and package the application
- `npm run package:win` - Build and package for Windows
- `npm run lint` - Run ESLint on the codebase

## Building & Packaging

To create a distributable package:

```bash
npm run package
```

For Windows-specific build:

```bash
npm run package:win
```

The packaged application will be available in the `release/` directory.

## Project Structure

```
vRadar/
├── electron/           # Electron main process
│   ├── core/          # Core services and utilities
│   │   ├── states/    # Game state handlers (pregame, ingame, menus)
│   │   └── ...        # Various service modules
│   ├── main.ts        # Main Electron process entry point
│   └── preload.ts     # Preload script for IPC
├── src/               # React frontend
│   ├── components/   # React components
│   ├── pages/         # Main page components
│   └── types/         # TypeScript type definitions
├── public/            # Static assets (fonts, images)
├── dist/              # Compiled output (generated)
└── config.json        # Application configuration
```

## Technologies

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Electron, Node.js, TypeScript
- **APIs**: Valorant API, Henrik Dev API
- **WebSocket**: ws library for real-time communication
- **UI**: Custom CSS with modern design patterns

## Configuration

The application uses `config.json` for configuration. Key settings include:

- `cooldown`: API request cooldown time
- `port`: WebSocket server port
- `weapon`: Default weapon for skin display

## API Key Setup

vRadar uses the Henrik Dev API for player statistics. The application includes a default API key, but you can provide your own in the Settings menu for better rate limits and reliability.

To get your own API key:
1. Visit [Henrik Dev API](https://henrikdev.xyz/)
2. Sign up and get your API key
3. Enter it in the Settings menu within vRadar

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Issues

If you encounter any bugs or have feature requests, please open an issue on GitHub. When reporting bugs, please include:

- Your operating system
- Node.js version
- Steps to reproduce the issue
- Any error messages or logs

## License

ISC License - see [LICENSE](LICENSE) file for details.
