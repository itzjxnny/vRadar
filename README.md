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


## Building & Packaging

To create a distributable package:

```bash
npm run package
```

For Windows-specific build:

```bash
npm run package:win
```

## API Key Setup

vRadar uses the Henrik Dev API for player statistics. The application includes a default API key, but you can provide your own in the Settings menu for better rate limits and reliability.

To get your own API key:
1. Visit [HenrikDev Discord](https://discord.gg/bruEBrAV)
2. Generate a key with their bot
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
