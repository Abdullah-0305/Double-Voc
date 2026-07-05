require('dotenv').config();
require('opusscript');

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// --- AUTO-UPDATER CONFIGURATION ---
const GITHUB_REPO = 'Abdullah-0305/Double-Voc';
const CURRENT_VERSION = 'v1.2.0'; 

async function checkAndUpdate() {
    if (typeof process.pkg === 'undefined') return;

    console.log("🔄 Recherche de mise à jour...");
    const exeName = path.basename(process.execPath);

    const options = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPO}/releases/latest`,
        headers: { 'User-Agent': 'BotRaid-Updater' }
    };

    return new Promise((resolve) => {
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const release = JSON.parse(data);
                    if (release.tag_name && release.tag_name !== CURRENT_VERSION) {
                        console.log(`✨ Nouvelle version trouvée : ${release.tag_name} ! Téléchargement...`);
                        
                        const asset = release.assets.find(a => a.name.endsWith('.exe'));
                        if (asset) {
                            telechargerEtInstaller(asset.browser_download_url, exeName);
                        } else {
                            console.log("⚠️ Aucun exécutable trouvé dans la release.");
                            resolve();
                        }
                    } else {
                        console.log("✅ Le système est à jour.");
                        resolve();
                    }
                } catch (e) {
                    console.log("⚠️ Impossible de lire les versions GitHub.");
                    resolve();
                }
            });
        }).on('error', () => {
            console.log("⚠️ Impossible de se connecter à GitHub.");
            resolve();
        });
    });
}

function telechargerEtInstaller(url, exeName) {
    const updateFile = 'BotUpdate.tmp';
    
    https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
            https.get(res.headers.location, (redirectRes) => {
                const file = fs.createWriteStream(updateFile);
                redirectRes.pipe(file);
                file.on('finish', () => {
                    file.close();
                    installerMiseAJour(exeName, updateFile);
                });
            });
        }
    });
}

function installerMiseAJour(exeName, updateFile) {
    console.log("🛠️ Téléchargement terminé ! Redémarrage pour installation...");
    
    const batContent = `
@echo off
timeout /t 3 /nobreak > NUL
move /y "${updateFile}" "${exeName}"
start "" "${exeName}"
del "%~f0"
    `;
    fs.writeFileSync('update.bat', batContent);

    const bat = spawn('cmd.exe', ['/c', 'update.bat'], {
        detached: true,
        stdio: 'ignore'
    });
    bat.unref();
    process.exit(0); 
}

const { Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const prism = require('prism-media');
const { Mixer } = require('audio-mixer');
const { 
    joinVoiceChannel, createAudioPlayer, createAudioResource, 
    EndBehaviorType, AudioPlayerStatus, StreamType, getVoiceConnection 
} = require('@discordjs/voice');

// --- CONFIGURATION ---
const ROLE_AUTHORISE_ID = process.env.ROLE_AUTHORISE_ID; 
const ROLE_CHEF_GROUPE_ID = process.env.ROLE_CHEF_GROUPE_ID; 
const ROLE_PARTICIPANT_ID = process.env.ROLE_PARTICIPANT_ID;
const ROLE_ALLIANCE_ID = process.env.ROLE_ALLIANCE_ID; // 👈 NOUVEAU ROLE
const GUILD_ID = process.env.GUILD_ID;

// --- VARIABLES GLOBALES ---
const intercomChefs = new Set(); 

// --- LES TABLES DE MIXAGE & LECTEURS ---
const mixeurGlobal = new Mixer({ channels: 2, bitDepth: 16, sampleRate: 48000, clearInterval: 250 });
mixeurGlobal.setMaxListeners(0);
const lecteurGlobal = createAudioPlayer();
lecteurGlobal.on('error', e => console.error(`⚠️ Erreur lecteur global: ${e.message}`));
lecteurGlobal.on(AudioPlayerStatus.Idle, () => {
    lecteurGlobal.play(createAudioResource(mixeurGlobal, { inputType: StreamType.Raw }));
});

const mixeurPourRL = new Mixer({ channels: 2, bitDepth: 16, sampleRate: 48000, clearInterval: 250 });
mixeurPourRL.setMaxListeners(0);
const lecteurRL = createAudioPlayer();
lecteurRL.on('error', e => console.error(`⚠️ Erreur lecteur RL: ${e.message}`));
lecteurRL.on(AudioPlayerStatus.Idle, () => {
    lecteurRL.play(createAudioResource(mixeurPourRL, { inputType: StreamType.Raw }));
});

// --- INITIALISATION DES BOTS (1 Listener + 11 Speakers) ---
const clientOptions = { intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] };

const botListener = new Client(clientOptions);
// Création d'un tableau de 11 bots automatiquement
const botSpeakers = Array.from({ length: 14 }, () => new Client(clientOptions)); 

// --- ENREGISTREMENT DES COMMANDES ---
botListener.once(Events.ClientReady, async () => {
    console.log(`🟢 BOT EN LIGNE : ${botListener.user.tag}`);
    
    const guild = botListener.guilds.cache.get(GUILD_ID);
    if (guild) {
        await guild.commands.set([
            {
                name: 'raid',
                description: 'Déploie 10 salons vocaux de Raid'
            },
            {
                name: 'chateau',
                description: 'Déploie 15 salons vocaux de Château avec autorisation Alliance'
            },
            {
                name: 'stop',
                description: 'Arrête le déploiement, déconnecte les bots et supprime les salons'
            }
        ]);
        console.log("✅ Commandes /raid, /chateau et /stop enregistrées !");
    }
});

// --- RÉCEPTION DES COMMANDES ET BOUTONS ---
botListener.on(Events.InteractionCreate, async (interaction) => {
    
    // ==========================================
    // 🎛️ GESTION DU BOUTON INTERCOM DES CHEFS
    // ==========================================
    if (interaction.isButton()) {
        if (interaction.customId === 'toggle_intercom') {
            if (!interaction.member.roles.cache.has(ROLE_CHEF_GROUPE_ID)) {
                return interaction.reply({ content: "⛔ Accès refusé. Seuls les Chefs de Groupe peuvent utiliser ce bouton.", ephemeral: true });
            }

            const userId = interaction.user.id;

            if (intercomChefs.has(userId)) {
                intercomChefs.delete(userId);
                return interaction.reply({ 
                    content: "🔴 **INTERCOM COUPÉ** : Le Raid Lead ne t'entend plus. Tu parles uniquement à ton groupe local.", 
                    ephemeral: true 
                });
            } else {
                intercomChefs.add(userId);
                return interaction.reply({ 
                    content: "🟢 **INTERCOM ACTIF** : Le Raid Lead t'entendra directement dans son casque dès que tu parleras !", 
                    ephemeral: true 
                });
            }
        }
    }

    if (!interaction.isChatInputCommand()) return;
    const guild = interaction.guild;

    // ==========================================
    // 🔴 COMMANDE : /STOP
    // ==========================================
    if (interaction.commandName === 'stop') {
        await interaction.reply("🛑 Arrêt du système en cours...");
        intercomChefs.clear();

        getVoiceConnection(guild.id, 'listener_group')?.destroy();
        for (let i = 2; i <= 15; i++) {
            getVoiceConnection(guild.id, `speaker_group_${i}`)?.destroy();
        }

        try {
            const categoriesASupprimer = guild.channels.cache.filter(c => 
                c.type === ChannelType.GuildCategory && 
                (c.name.startsWith('🔴 RAID') || c.name.startsWith('🔴 CHÂTEAU'))
            );
            
            for (const [id, categorie] of categoriesASupprimer) {
                const enfants = guild.channels.cache.filter(c => c.parentId === categorie.id);
                for (const [enfantId, enfant] of enfants) {
                    await enfant.delete().catch(() => {});
                }
                await categorie.delete().catch(() => {});
            }
            
            await interaction.editReply("✅ Système désactivé et salons nettoyés avec succès !");

            botSpeakers.forEach(bot => {
                if (bot.isReady()) bot.destroy();
            });
            botListener.destroy();

            setTimeout(() => { process.exit(0); }, 2000);
        } catch (e) {
            console.error(e);
            await interaction.editReply("⚠️ Erreur lors de la suppression des salons.");
        }
    }

    // ==========================================
    // 🟢 COMMANDES : /RAID ET /CHATEAU
    // ==========================================
    if (interaction.commandName === 'raid' || interaction.commandName === 'chateau') {
        
        const isChateau = interaction.commandName === 'chateau';
        const nbVocauxTotal = isChateau ? 15 : 10; // 12 pour Château, 8 pour Raid
        const titreCategorie = isChateau ? `🔴 CHÂTEAU - ${nbVocauxTotal} GROUPES` : `🔴 RAID - ${nbVocauxTotal} GROUPES`;

        await interaction.reply(`Création de l'infrastructure (${nbVocauxTotal} salons vocaux)...`);

        try {
            intercomChefs.clear();

            // Configuration des permissions de base
            const permsCategorie = [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: ROLE_PARTICIPANT_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }
            ];

            // Ajout du rôle Alliance uniquement si c'est un Château
            if (isChateau && ROLE_ALLIANCE_ID) {
                permsCategorie.push({ id: ROLE_ALLIANCE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] });
            }

            const categorie = await guild.channels.create({
                name: titreCategorie,
                type: ChannelType.GuildCategory,
                position: 4,
                permissionOverwrites: permsCategorie,
            });

            // 👑 SALON COMMANDANT (Le 1er vocal)
            const nomSalonLead = isChateau ? '👑 COMMANDANT CHÂTEAU' : '👑 RAID LEAD';
            const salonLead = await guild.channels.create({
                name: nomSalonLead,
                type: ChannelType.GuildVoice,
                parent: categorie.id,
            });

            const connListener = joinVoiceChannel({
                channelId: salonLead.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                group: 'listener_group', 
                selfMute: false, selfDeaf: false
            });

            connListener.subscribe(lecteurRL); 
            ecouterRaidLead(connListener, salonLead.guild); 

            // ⚔️ SALONS GROUPES (Du 2ème au 8ème/12ème vocal)
            for (let i = 2; i <= nbVocauxTotal; i++) {
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
                    selfMute: false, selfDeaf: false
                });

                connSpeaker.subscribe(lecteurGlobal); 
                ecouterChefGroupe(connSpeaker, salonGroupe.guild); 
            }

            // 🎛️ SALON TEXTE DASHBOARD CHEFS
            const salonDashboard = await guild.channels.create({
                name: '🎛️-dashboard-chefs',
                type: ChannelType.GuildText,
                parent: categorie.id,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: ROLE_CHEF_GROUPE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: ROLE_AUTHORISE_ID, allow: [PermissionFlagsBits.ViewChannel] }
                ],
            });

            const rowBouton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('toggle_intercom')
                    .setLabel('📻 Parler uniquement au Commandant (ON / OFF)')
                    .setStyle(ButtonStyle.Primary)
            );

            await salonDashboard.send({
                content: "**CONSOLE CHEFS DE GROUPE**\nCliquez sur le bouton ci-dessous pour ouvrir/fermer votre micro en direction du Commandant uniquement.\n*(Ce message est personnel, cliquer dessus n'impacte pas les autres chefs)*",
                components: [rowBouton]
            });

            lecteurGlobal.play(createAudioResource(mixeurGlobal, { inputType: StreamType.Raw }));
            lecteurRL.play(createAudioResource(mixeurPourRL, { inputType: StreamType.Raw }));

            await interaction.editReply(`✅ Déploiement terminé avec succès !`);

        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Erreur de déploiement ! Vérifiez les permissions et les IDs.");
        }
    }
});

// --- 👑 GESTION DE LA VOIX DU COMMANDANT ---
function ecouterRaidLead(connexion, guild) {
    connexion.receiver.speaking.on('start', (userId) => {
        const member = guild.members.cache.get(userId);
        if (!member || !member.roles.cache.has(ROLE_AUTHORISE_ID)) return;

        const fluxAudio = connexion.receiver.subscribe(userId, {
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

// --- ⚔️ GESTION DE LA VOIX DES CHEFS DE GROUPE ---
function ecouterChefGroupe(connexion, guild) {
    connexion.receiver.speaking.on('start', (userId) => {
        if (!intercomChefs.has(userId)) return; 

        const member = guild.members.cache.get(userId);
        if (!member || !member.roles.cache.has(ROLE_CHEF_GROUPE_ID)) return;

        const fluxAudio = connexion.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
        });

        const pcmDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
        const piste = mixeurPourRL.input({ channels: 2, bitDepth: 16, sampleRate: 48000 });

        pcmDecoder.on('error', () => {}); 
        fluxAudio.pipe(pcmDecoder).pipe(piste);

        fluxAudio.on('end', () => {
            mixeurPourRL.removeInput(piste);
            piste.destroy?.();
            pcmDecoder.destroy?.();
        });
    });
}

// --- LANCEMENT DE TOUS LES BOTS ---
(async () => {
    await checkAndUpdate();

    botListener.login(process.env.LISTENER_TOKEN);

    const tokensSpeakers = [
        process.env.SPEAKER_TOKEN_1, process.env.SPEAKER_TOKEN_2, process.env.SPEAKER_TOKEN_3,
        process.env.SPEAKER_TOKEN_4, process.env.SPEAKER_TOKEN_5, process.env.SPEAKER_TOKEN_6,
        process.env.SPEAKER_TOKEN_7, process.env.SPEAKER_TOKEN_8, process.env.SPEAKER_TOKEN_9,
        process.env.SPEAKER_TOKEN_10, process.env.SPEAKER_TOKEN_11, process.env.SPEAKER_TOKEN_12,
        process.env.SPEAKER_TOKEN_13, process.env.SPEAKER_TOKEN_14
    ];

    botSpeakers.forEach((bot, index) => {
        bot.once(Events.ClientReady, () => console.log(`🟢 Speaker ${index + 1} prêt !`));
        bot.login(tokensSpeakers[index]);
    });
})();