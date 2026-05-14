require('dotenv').config();
const { Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const prism = require('prism-media');
const { Mixer } = require('audio-mixer');
const { 
    joinVoiceChannel, createAudioPlayer, createAudioResource, 
    EndBehaviorType, AudioPlayerStatus, StreamType, getVoiceConnection 
} = require('@discordjs/voice');

// --- CONFIGURATION ---
const ROLE_AUTHORISE_ID = process.env.ROLE_AUTHORISE_ID;
const ROLE_PARTICIPANT_ID = process.env.ROLE_PARTICIPANT_ID;
const GUILD_ID = process.env.GUILD_ID;

// --- LA TABLE DE MIXAGE ---
const mixeurGlobal = new Mixer({ channels: 2, bitDepth: 16, sampleRate: 48000, clearInterval: 250 });
mixeurGlobal.setMaxListeners(0);

const lecteurAudio = createAudioPlayer();
lecteurAudio.on('error', e => console.error(`⚠️ Erreur lecteur: ${e.message}`));
lecteurAudio.on(AudioPlayerStatus.Idle, () => {
    lecteurAudio.play(createAudioResource(mixeurGlobal, { inputType: StreamType.Raw }));
});

// --- INITIALISATION DES 7 BOTS ---
const clientOptions = { intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] };

const botListener = new Client(clientOptions);
const botSpeakers = [
    new Client(clientOptions), new Client(clientOptions), new Client(clientOptions),
    new Client(clientOptions), new Client(clientOptions), new Client(clientOptions)
];

// --- ENREGISTREMENT DES COMMANDES ---
botListener.once(Events.ClientReady, async () => {
    console.log(`🟢 COMMANDANT EN LIGNE : ${botListener.user.tag}`);
    
    const guild = botListener.guilds.cache.get(GUILD_ID);
    if (guild) {
        await guild.commands.set([
            {
                name: 'raid',
                description: 'Déploie les salons de Raid et les bots'
            },
            {
                name: 'stop',
                description: 'Arrête le raid, déconnecte les bots et supprime les salons'
            }
        ]);
        console.log("✅ Commandes /raid et /stop enregistrées !");
    }
});

// --- RÉCEPTION DES COMMANDES ---
botListener.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const guild = interaction.guild;

    // ==========================================
    // 🔴 COMMANDE : /STOP
    // ==========================================
    if (interaction.commandName === 'stop') {
        await interaction.reply("🛑 Arrêt du système en cours...");

        getVoiceConnection(guild.id, 'listener_group')?.destroy();
        for (let i = 2; i <= 7; i++) {
            getVoiceConnection(guild.id, `speaker_group_${i}`)?.destroy();
        }

        try {
            const categoriesRaid = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory && c.name.startsWith('🔴 RAID'));
            
            for (const [id, categorie] of categoriesRaid) {
                const enfants = guild.channels.cache.filter(c => c.parentId === categorie.id);
                for (const [enfantId, enfant] of enfants) {
                    await enfant.delete().catch(() => {});
                }
                await categorie.delete().catch(() => {});
            }
            
            await interaction.editReply("✅ Système de Raid désactivé et salons nettoyés avec succès !");
        } catch (e) {
            console.error(e);
            await interaction.editReply("⚠️ Erreur lors de la suppression des salons.");
        }
    }

    // ==========================================
    // 🟢 COMMANDE : /RAID
    // ==========================================
    if (interaction.commandName === 'raid') {
        await interaction.reply(`Création des salons vocaux pour 8 groupes.`);

        try {
            // CRÉATION DE LA CATÉGORIE AVEC PERMISSIONS PRIVÉES
            const categorie = await guild.channels.create({
                name: `🔴 RAID - 7 GROUPES`,
                type: ChannelType.GuildCategory,
                position: 4,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: ROLE_PARTICIPANT_ID,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                    }
                ],
            });

            const salonLead = await guild.channels.create({
                name: '👑 RAID LEAD',
                type: ChannelType.GuildVoice,
                parent: categorie.id, // Hérite automatiquement des permissions de la catégorie
            });

            const connListener = joinVoiceChannel({
                channelId: salonLead.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                group: 'listener_group', 
                selfMute: true, selfDeaf: false
            });

            ecouterRaidLead(connListener, salonLead.guild);

            for (let i = 2; i <= 7; i++) {
                const salonGroupe = await guild.channels.create({
                    name: `⚔️ GROUPE ${i}`,
                    type: ChannelType.GuildVoice,
                    parent: categorie.id,
                });

                const botHautParleurActuel = botSpeakers[i - 2];

                const connSpeaker = joinVoiceChannel({
                    channelId: salonGroupe.id,
                    guildId: guild.id,
                    adapterCreator: botHautParleurActuel.guilds.cache.get(GUILD_ID).voiceAdapterCreator,
                    group: `speaker_group_${i}`, 
                    selfMute: false, selfDeaf: true
                });

                connSpeaker.subscribe(lecteurAudio);
            }

            lecteurAudio.play(createAudioResource(mixeurGlobal, { inputType: StreamType.Raw }));
            await interaction.editReply(`✅ Salons vocaux crées.`);

        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Erreur !");
        }
    }
});

// --- GESTION DE LA VOIX DU LEAD ---
function ecouterRaidLead(connexionListener, guild) {
    connexionListener.receiver.speaking.on('start', (userId) => {
        const member = guild.members.cache.get(userId);
        
        if (!member || !member.roles.cache.has(ROLE_AUTHORISE_ID)) return;

        const fluxAudio = connexionListener.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
        });

        const pcmDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
        const piste = mixeurGlobal.input({ channels: 2, bitDepth: 16, sampleRate: 48000 });

        pcmDecoder.on('error', () => {}); 
        fluxAudio.pipe(pcmDecoder).pipe(piste);

        fluxAudio.on('end', () => {
            mixeurGlobal.removeInput(piste);
            piste.destroy?.();
            pcmDecoder.destroy?.();
        });
    });
}

// --- LANCEMENT DE TOUS LES BOTS ---
botListener.login(process.env.LISTENER_TOKEN);

const tokensSpeakers = [
    process.env.SPEAKER_TOKEN_1, process.env.SPEAKER_TOKEN_2, process.env.SPEAKER_TOKEN_3,
    process.env.SPEAKER_TOKEN_4, process.env.SPEAKER_TOKEN_5, process.env.SPEAKER_TOKEN_6
];

botSpeakers.forEach((bot, index) => {
    bot.once(Events.ClientReady, () => console.log(`🟢 Speaker ${index + 1} prêt !`));
    bot.login(tokensSpeakers[index]);
});