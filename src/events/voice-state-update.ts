import {VoiceChannel, VoiceState} from 'discord.js';
import {VoiceConnectionStatus} from '@discordjs/voice';
import container from '../inversify.config.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {getSizeWithoutBots} from '../utils/channels.js';

const EMPTY_CHANNEL_TIMEOUT_SECONDS = 10 * 60; // 10 minutes

export default async (oldState: VoiceState, newState: VoiceState): Promise<void> => {
  const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);
  const player = playerManager.get(oldState.guild.id);

  if (!player.voiceConnection || player.voiceConnection.state.status !== VoiceConnectionStatus.Ready) {
    return;
  }

  const {channelId} = player.voiceConnection.joinConfig;
  if (!channelId || (oldState.channelId !== channelId && newState.channelId !== channelId)) {
    return;
  }

  const voiceChannel = newState.guild.channels.cache.get(channelId) as VoiceChannel | undefined;
  if (!voiceChannel) {
    player.disconnect();
    return;
  }

  if (getSizeWithoutBots(voiceChannel) === 0) {
    player.scheduleEmptyChannelDisconnect(EMPTY_CHANNEL_TIMEOUT_SECONDS);
  } else {
    player.cancelEmptyChannelDisconnect();
  }
};
