# Discord Voice Bot

A simple Discord bot that can join and leave voice channels.

## Setup

1. Make sure you have Node.js installed (v16.9.0 or higher)
2. Install dependencies: `npm install`
3. Create a Discord bot and get its token from the [Discord Developer Portal](https://discord.com/developers/applications)
4. Add the bot to your server with the following permissions:
   - `bot`
   - `applications.commands`
   - `View Channels`
   - `Connect`
   - `Speak`
5. Copy `.env.example` to `.env` and fill in your bot token
6. Start the bot: `node index.js`

## Commands

- `/join` - Makes the bot join your voice channel
- `/leave` - Makes the bot leave the voice channel

## Note

This is a basic implementation. You can extend it by adding audio playback features using the `createAudioResource` function.
