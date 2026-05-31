require('dotenv').config();
require('opusscript');


const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// --- AUTO-UPDATER CONFIGURATION ---
const GITHUB_REPO = 'Abdullah-0305/Double-Voc'; // 👈 À MODIFIER (ex: 'Gree/Double-Voc')
const CURRENT_VERSION = 'v1.1.0'; 

async function checkAndUpdate() {
    // Sécurité : On ne lance la maj que si le bot tourne via le .exe compilé
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
                    // Si on trouve une version différente de la nôtre
                    if (release.tag_name && release.tag_name !== CURRENT_VERSION) {
                        console.log(`✨ Nouvelle version trouvée : ${release.tag_name} ! Téléchargement...`);
                        
                        // Cherche le fichier qui se termine par .exe dans les assets GitHub
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
    
    // GitHub fait des redirections pour les téléchargements, on doit les suivre
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
    
    // On crée un petit script BAT qui va faire le remplacement
    const batContent = `
@echo off
timeout /t 3 /nobreak > NUL
move /y "${updateFile}" "${exeName}"
start "" "${exeName}"
del "%~f0"
    `;
    fs.writeFileSync('update.bat', batContent);

    // On lance le script de manière détachée et on "suicide" le bot actuel
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
const ROLE_AUTHORISE_ID = process.env.ROLE_AUTHORISE_ID; // Le Raid Lead (RL)
const ROLE_CHEF_GROUPE_ID = process.env.ROLE_CHEF_GROUPE_ID; // Le Chef de Groupe
const ROLE_PARTICIPANT_ID = process.env.ROLE_PARTICIPANT_ID;
const GUILD_ID = process.env.GUILD_ID;
const NB_GROUPES = process.env.NB_GROUPES;

// --- VARIABLES GLOBALES ---
const intercomChefs = new Set(); // Retient quels chefs de groupe ont activé leur micro vers le RL

// --- LES TABLES DE MIXAGE & LECTEURS ---
// 1. Mixeur Global (Diffuse la voix du RL vers TOUS les groupes)
const mixeurGlobal = new Mixer({ channels: 2, bitDepth: 16, sampleRate: 48000, clearInterval: 250 });
mixeurGlobal.setMaxListeners(0);
const lecteurGlobal = createAudioPlayer();
lecteurGlobal.on('error', e => console.error(`⚠️ Erreur lecteur global: ${e.message}`));
lecteurGlobal.on(AudioPlayerStatus.Idle, () => {
    lecteurGlobal.play(createAudioResource(mixeurGlobal, { inputType: StreamType.Raw }));
});

// 2. Mixeur pour le RL (Diffuse la voix des Chefs de Groupe uniquement au RL)
const mixeurPourRL = new Mixer({ channels: 2, bitDepth: 16, sampleRate: 48000, clearInterval: 250 });
mixeurPourRL.setMaxListeners(0);
const lecteurRL = createAudioPlayer();
lecteurRL.on('error', e => console.error(`⚠️ Erreur lecteur RL: ${e.message}`));
lecteurRL.on(AudioPlayerStatus.Idle, () => {
    lecteurRL.play(createAudioResource(mixeurPourRL, { inputType: StreamType.Raw }));
});

// --- INITIALISATION DES BOTS ---
const clientOptions = { intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] };

const botListener = new Client(clientOptions);
const botSpeakers = [
    new Client(clientOptions), new Client(clientOptions), new Client(clientOptions),
    new Client(clientOptions), new Client(clientOptions), new Client(clientOptions),
    new Client(clientOptions), new Client(clientOptions), new Client(clientOptions)
];

// --- ENREGISTREMENT DES COMMANDES ---
botListener.once(Events.ClientReady, async () => {
    console.log(`🟢 BOT EN LIGNE : ${botListener.user.tag}`);
    
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

// --- RÉCEPTION DES COMMANDES ET BOUTONS ---
botListener.on(Events.InteractionCreate, async (interaction) => {
    
    // ==========================================
    // 🎛️ GESTION DU BOUTON INTERCOM DES CHEFS
    // ==========================================
    if (interaction.isButton()) {
        if (interaction.customId === 'toggle_intercom') {
            // Vérifier que celui qui clique a bien le rôle Chef de Groupe
            if (!interaction.member.roles.cache.has(ROLE_CHEF_GROUPE_ID)) {
                return interaction.reply({ content: "⛔ Accès refusé. Seuls les Chefs de Groupe peuvent utiliser ce bouton.", ephemeral: true });
            }

            const userId = interaction.user.id;

            // Si le chef est déjà en mode transmission (ON), on l'éteint (OFF)
            if (intercomChefs.has(userId)) {
                intercomChefs.delete(userId);
                return interaction.reply({ 
                    content: "🔴 **INTERCOM COUPÉ** : Le Raid Lead ne t'entend plus. Tu parles uniquement à ton groupe local.", 
                    ephemeral: true 
                });
            } 
            // Sinon on l'active (ON)
            else {
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
        for (let i = 2; i <= NB_GROUPES; i++) {
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
    // 🟢 COMMANDE : /RAID
    // ==========================================
    if (interaction.commandName === 'raid') {
        await interaction.reply(`Création des salons vocaux pour ${NB_GROUPES} groupes.`);

        try {
            intercomChefs.clear();

            const categorie = await guild.channels.create({
                name: `🔴 RAID - ${NB_GROUPES} GROUPES`,
                type: ChannelType.GuildCategory,
                position: 4,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: ROLE_PARTICIPANT_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] }
                ],
            });

            // 👑 SALON RAID LEAD
            const salonLead = await guild.channels.create({
                name: '👑 RAID LEAD',
                type: ChannelType.GuildVoice,
                parent: categorie.id,
            });

            const connListener = joinVoiceChannel({
                channelId: salonLead.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                group: 'listener_group', 
                selfMute: false, selfDeaf: false // Écoute le RL et lui parle (les remontées des chefs)
            });

            connListener.subscribe(lecteurRL); // Le bot du RL diffuse le mixeur contenant la voix des chefs
            ecouterRaidLead(connListener, salonLead.guild); // Le bot écoute la voix du RL

            // ⚔️ SALONS GROUPES
            for (let i = 2; i <= NB_GROUPES; i++) {
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
                    selfMute: false, selfDeaf: false // Parle au groupe (voix du RL) et écoute le Chef de groupe
                });

                connSpeaker.subscribe(lecteurGlobal); // Diffuse la voix du RL reçue du mixeur global
                ecouterChefGroupe(connSpeaker, salonGroupe.guild); // Écoute s'il y a un chef de groupe dans le salon
            }

            // 🎛️ SALON TEXTE DASHBOARD CHEFS (Privé pour les Chefs de Groupe et le RL)
            const salonDashboard = await guild.channels.create({
                name: '🎛️-dashboard-chefs',
                type: ChannelType.GuildText,
                parent: categorie.id,
                permissionOverwrites: [
                    { 
                        id: guild.roles.everyone.id, 
                        deny: [PermissionFlagsBits.ViewChannel] 
                    },
                    { 
                        id: ROLE_CHEF_GROUPE_ID, 
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] 
                    }
                ],
            });
            const rowBouton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('toggle_intercom')
                    .setLabel('📻 Parler uniquement au Raid Lead (ON / OFF)')
                    .setStyle(ButtonStyle.Primary)
            );

            await salonDashboard.send({
                content: "**CONSOLE CHEFS DE GROUPE**\nCliquez sur le bouton ci-dessous pour ouvrir/fermer votre micro en direction du Raid Lead uniquement.\n*(Ce message est personnel, cliquez dessus n'impacte pas les autres chefs)*",
                components: [rowBouton]
            });

            // Lancement initial des flux de mixage
            lecteurGlobal.play(createAudioResource(mixeurGlobal, { inputType: StreamType.Raw }));
            lecteurRL.play(createAudioResource(mixeurPourRL, { inputType: StreamType.Raw }));

            await interaction.editReply(`✅ Salons vocaux et Dashboard créés avec succès.`);

        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Erreur !");
        }
    }
});

// --- 👑 GESTION DE LA VOIX DU RAID LEAD (Toujours actif pour tout le monde) ---
function ecouterRaidLead(connexion, guild) {
    connexion.receiver.speaking.on('start', (userId) => {
        const member = guild.members.cache.get(userId);
        
        // On vérifie que c'est bien le Raid Lead (ROLE_AUTHORISE_ID)
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

// --- ⚔️ GESTION DE LA VOIX DES CHEFS DE GROUPE (Filtré par bouton personnel vers le RL) ---
function ecouterChefGroupe(connexion, guild) {
    connexion.receiver.speaking.on('start', (userId) => {
        // 🔒 Si ce Chef n'a pas activé son bouton personnel, on ignore totalement sa voix
        if (!intercomChefs.has(userId)) return; 

        const member = guild.members.cache.get(userId);
        
        // On vérifie qu'il possède bien le rôle Chef de Groupe
        if (!member || !member.roles.cache.has(ROLE_CHEF_GROUPE_ID)) return;

        const fluxAudio = connexion.receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
        });

        const pcmDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
        // 🎯 On injecte dans le mixeur destiné UNIQUEMENT au Raid Lead
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
    // On vérifie d'abord les maj GitHub
    await checkAndUpdate();

    // S'il n'y a pas de maj, on allume les bots normalement
    botListener.login(process.env.LISTENER_TOKEN);

    const tokensSpeakers = [
        process.env.SPEAKER_TOKEN_1, process.env.SPEAKER_TOKEN_2, process.env.SPEAKER_TOKEN_3,
        process.env.SPEAKER_TOKEN_4, process.env.SPEAKER_TOKEN_5, process.env.SPEAKER_TOKEN_6,
        process.env.SPEAKER_TOKEN_7, process.env.SPEAKER_TOKEN_8, process.env.SPEAKER_TOKEN_9
    ];

    botSpeakers.forEach((bot, index) => {
        bot.once(Events.ClientReady, () => console.log(`🟢 Speaker ${index + 1} prêt !`));
        bot.login(tokensSpeakers[index]);
    });
})();