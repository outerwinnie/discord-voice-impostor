const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, NoSubscriberBehavior, getVoiceConnection, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { opus } = require('prism-media');

// Load configuration from environment variables
const config = {
    token: process.env.DISCORD_TOKEN,
    guildId: process.env.GUILD_ID,
    voiceChannelId: process.env.VOICE_CHANNEL_ID,
    activeHours: {
        start: parseInt(process.env.ACTIVE_HOUR_START || '16', 10),
        end: parseInt(process.env.ACTIVE_HOUR_END || '23', 10)
    },
    session: {
        durationMin: parseInt(process.env.SESSION_DURATION_MIN || '34', 10),
        durationMax: parseInt(process.env.SESSION_DURATION_MAX || '72', 10),
        delayMin: parseInt(process.env.SESSION_DELAY_MIN || '75', 10),
        delayMax: parseInt(process.env.SESSION_DELAY_MAX || '105', 10)
    }
};

// Validate required environment variables
const requiredVars = ['DISCORD_TOKEN', 'GUILD_ID', 'VOICE_CHANNEL_ID'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    console.error('Please copy .env.example to .env and fill in the required values');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

let connection = null;
let checkInterval = null;
let disconnectTimer = null;
let sessionTimer = null;
let nextSessionTimeout = null;

function isWithinActiveHours() {
    const now = new Date();
    const hours = now.getHours();
    return hours >= config.activeHours.start && hours < config.activeHours.end;
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getNextSessionDelay() {
    // Get random delay between configured min and max (in milliseconds)
    return getRandomInt(config.session.delayMin, config.session.delayMax) * 60 * 1000;
}

function getRandomSessionDuration() {
    // Get random duration between configured min and max (in milliseconds)
    return getRandomInt(config.session.durationMin, config.session.durationMax) * 60 * 1000;
}

function hasOtherMembers(channel) {
    // Count members in the channel excluding the bot
    return channel.members.filter(member => !member.user.bot).size > 0;
}

function scheduleDisconnect(connection, delay = 3000) {
    // Clear any existing timer
    if (disconnectTimer) clearTimeout(disconnectTimer);
    
    // Set a new timer to disconnect after the delay
    disconnectTimer = setTimeout(() => {
        if (connection) {
            console.log('Disconnecting after member joined...');
            connection.destroy().catch(console.error);
            connection = null;
        }
    }, delay);
}

async function startRandomSession() {
    if (!isWithinActiveHours()) {
        console.log('Outside of active hours (16:00-23:00), not starting session');
        return;
    }
    
    try {
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) {
            console.error('Error: Guild not found with ID:', config.guildId);
            return false;
        }
        
        const channel = guild.channels.cache.get(config.voiceChannelId);
        if (!channel) {
            console.error('Error: Voice channel not found with ID:', config.voiceChannelId);
            return false;
        }

        // Don't connect if there are other members in the channel
        if (hasOtherMembers(channel)) {
            console.log('Not starting session: There are other members in the channel');
            return false;
        }

        console.log('Starting a new random session...');
        await connectToVoice(guild, channel);
        
        // Schedule session end (up to 1 hour)
        const sessionDuration = getRandomSessionDuration();
        console.log(`Session will last for ${Math.floor(sessionDuration / 60000)} minutes`);
        
        sessionTimer = setTimeout(() => {
            console.log('Session time complete, disconnecting...');
            safeDisconnect();
            scheduleNextSession();
        }, sessionDuration);
        
        return true;
    } catch (error) {
        console.error('Error in session:', error);
        safeDisconnect();
        return false;
    }
}

async function connectToVoice(guild, channel) {
    console.log('Connecting to voice channel...');
    try {
        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 30e3);
        console.log('Voice connection established');
        
        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });

        // Set up event handlers
        connection.on('stateChange', (oldState, newState) => {
            console.log(`Connection state: ${oldState.status} -> ${newState.status}`);
        });

        player.on('stateChange', (oldState, newState) => {
            console.log(`Player state: ${oldState.status} -> ${newState.status}`);
        });

        connection.subscribe(player);
        console.log(`✅ Successfully joined ${channel.name} in ${guild.name}`);
        
        // Set up listener for members joining
        client.on('voiceStateUpdate', handleVoiceStateUpdate);
        
    } catch (error) {
        console.error('Failed to connect to voice:', error);
        throw error;
    }
}

function handleVoiceStateUpdate(oldState, newState) {
    if (!connection) return;
    
    // Check if someone joined our channel
    if (newState.channelId === config.voiceChannelId && 
        newState.channelId !== oldState.channelId && 
        !newState.member.user.bot) {
        console.log(`Member ${newState.member.user.tag} joined, disconnecting...`);
        safeDisconnect();
        scheduleNextSession();
    }
}

function safeDisconnect() {
    // Clear any existing timers
    if (sessionTimer) clearTimeout(sessionTimer);
    if (nextSessionTimeout) clearTimeout(nextSessionTimeout);
    
    // Remove voice state listener
    client.off('voiceStateUpdate', handleVoiceStateUpdate);
    
    // Disconnect if connected
    if (connection) {
        try {
            connection.destroy();
            console.log('Disconnected from voice channel');
        } catch (error) {
            console.error('Error disconnecting:', error);
        } finally {
            connection = null;
        }
    }
}

function scheduleNextSession() {
    if (!isWithinActiveHours()) {
        console.log('Outside of active hours, not scheduling next session');
        return;
    }
    
    const delay = getNextSessionDelay();
    console.log(`Next session in ${Math.floor(delay / 60000)} minutes`);
    
    nextSessionTimeout = setTimeout(() => {
        startRandomSession().then(success => {
            if (success) {
                // After session ends, schedule the next one
                const sessionDuration = getRandomSessionDuration();
                nextSessionTimeout = setTimeout(scheduleNextSession, sessionDuration);
            } else {
                // If session didn't start, try again sooner
                scheduleNextSession();
            }
        });
    }, delay);
}

async function checkAndManageConnection() {
    try {
        console.log('Checking connection status...');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            console.error('Error: Guild not found with ID:', guildId);
            return;
        }
        
        console.log('Found guild:', guild.name);
        
        const channel = guild.channels.cache.get(voiceChannelId);
        if (!channel) {
            console.error('Error: Voice channel not found with ID:', voiceChannelId);
            console.log('Available voice channels:');
            const voiceChannels = guild.channels.cache.filter(c => c.type === 2); // 2 is GUILD_VOICE
            voiceChannels.forEach(c => console.log(`- ${c.name} (${c.id})`));
            return;
        }

        console.log('Found voice channel:', channel.name);
        
        const shouldBeConnected = isWithinTimeRange();
        const isConnected = getVoiceConnection(guildId) !== null;
        
        // Don't connect if there are other members in the channel
        if (shouldBeConnected && !isConnected && hasOtherMembers(channel)) {
            console.log('Not connecting: There are other members in the channel');
            return;
        }
        
        console.log(`Time check: ${shouldBeConnected ? 'Within active hours' : 'Outside active hours'}`);
        console.log(`Current connection status: ${isConnected ? 'Connected' : 'Not connected'}`);

        if (shouldBeConnected && !isConnected) {
            console.log('Attempting to connect to voice channel...');
            try {
                connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: true
                });

                try {
                    // Wait for connection to be ready
                    await entersState(connection, VoiceConnectionStatus.Ready, 30e3);
                    
                    console.log('Voice connection established, setting up audio player...');
                    const player = createAudioPlayer({
                        behaviors: {
                            noSubscriber: NoSubscriberBehavior.Play
                        }
                    });

                    // Handle connection state changes
                    connection.on('stateChange', (oldState, newState) => {
                        console.log(`Connection state changed: ${oldState.status} -> ${newState.status}`);
                        
                        // Check for members joining/leaving when connected
                        if (newState.status === VoiceConnectionStatus.Ready) {
                            const voiceChannel = client.channels.cache.get(channel.id);
                            if (voiceChannel) {
                                // Set up listener for voice state updates
                                client.on('voiceStateUpdate', handleVoiceStateUpdate);
                                
                                // Check if someone is already in the channel
                                if (hasOtherMembers(voiceChannel)) {
                                    console.log('Members detected in channel, scheduling disconnect...');
                                    scheduleDisconnect(connection);
                                }
                            }
                        }
                    });
                    
                    // Function to handle voice state updates
                    const handleVoiceStateUpdate = (oldState, newState) => {
                        // Only care about updates in our target channel
                        if (newState.channelId === channel.id || oldState?.channelId === channel.id) {
                            // If someone joins the channel
                            if (newState.channelId === channel.id && !newState.member.user.bot) {
                                console.log(`Member ${newState.member.user.tag} joined the channel`);
                                scheduleDisconnect(connection);
                            }
                        }
                    };

                    // Handle player state changes
                    player.on('stateChange', (oldState, newState) => {
                        console.log(`Player state changed: ${oldState.status} -> ${newState.status}`);
                    });

                    // Subscribe the connection to the player
                    connection.subscribe(player);
                    
                    console.log(`✅ Successfully joined ${channel.name} in ${guild.name}`);
                    
                } catch (error) {
                    console.error('Failed to establish voice connection:', error);
                    if (connection) {
                        try {
                            connection.destroy();
                        } catch (e) {
                            console.error('Error cleaning up failed connection:', e);
                        } finally {
                            connection = null;
                        }
                    }
                    throw error;
                }
                
            } catch (error) {
                console.error('Failed to connect to voice channel:', error);
                if (connection) {
                    try {
                        connection.destroy();
                        connection = null;
                    } catch (e) {
                        console.error('Error cleaning up connection:', e);
                    }
                }
            }
        } else if (!shouldBeConnected && isConnected) {
            console.log('Disconnecting from voice channel...');
            if (connection) {
                try {
                    connection.destroy();
                    console.log('✅ Successfully left the voice channel');
                } catch (error) {
                    console.error('Error disconnecting from voice channel:', error);
                } finally {
                    connection = null;
                }
            } else {
                console.log('No active connection to disconnect');
            }
        }
    } catch (error) {
        console.error('Error managing voice connection:', error);
    }
}

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Start the first session check
    if (isWithinActiveHours()) {
        scheduleNextSession();
    } else {
        console.log('Not within active hours, waiting until 16:00...');
        // Schedule check for when active hours start
        const now = new Date();
        const startTime = new Date(now);
        startTime.setHours(16, 0, 0, 0);
        if (now > startTime) {
            // If it's past 16:00 but before 23:00, start now
            scheduleNextSession();
        } else {
            // Otherwise wait until 16:00
            const delay = startTime - now;
            console.log(`Will start first session in ${Math.floor(delay / 60000)} minutes`);
            setTimeout(scheduleNextSession, delay);
        }
    }
    
    // Set up daily reset at 23:00
    scheduleDailyReset();
});

function scheduleDailyReset() {
    const now = new Date();
    const resetTime = new Date(now);
    resetTime.setHours(23, 0, 0, 0);
    
    // If it's already past 23:00, set for next day
    if (now > resetTime) {
        resetTime.setDate(resetTime.getDate() + 1);
    }
    
    const delay = resetTime - now;
    console.log(`Next daily reset in ${Math.floor(delay / 3600000)} hours and ${Math.floor((delay % 3600000) / 60000)} minutes`);
    
    setTimeout(() => {
        console.log('Performing daily reset...');
        safeDisconnect();
        // Schedule next day's first session
        const nextDay = new Date();
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(16, 0, 0, 0);
        const nextDayDelay = nextDay - new Date();
        console.log(`Next session tomorrow at 16:00 (in ${Math.floor(nextDayDelay / 3600000)} hours)`);
        setTimeout(scheduleNextSession, nextDayDelay);
        
        // Schedule next reset
        scheduleDailyReset();
    }, delay);
}

// Clean up on process exit
process.on('SIGINT', () => {
    if (checkInterval) clearInterval(checkInterval);
    if (connection) connection.destroy();
    process.exit(0);
});

// Error handling
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Start a simple HTTP server for health checks
const http = require('http');
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(8080, '0.0.0.0', () => {
    console.log('Health check server running on port 8080');    
    // Login to Discord after health server is ready
    client.login(config.token).catch(console.error);
});
