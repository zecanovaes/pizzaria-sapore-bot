const { Client, LocalAuth, MessageMedia, Buttons } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const dotenv = require('dotenv');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Configurar ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Carregar variáveis de ambiente
dotenv.config();

// Configurações
const API_URL = process.env.API_URL || 'http://localhost:3001/api';
const MEDIA_PATH = './media';

// Inicializar OpenAI para transcrição
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Criar pasta de mídia se não existir
if (!fs.existsSync(MEDIA_PATH)) {
  fs.mkdirSync(MEDIA_PATH, { recursive: true });
}

// Inicializar cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    headless: true
  }
});

// Evento quando o QR code é gerado
client.on('qr', (qr) => {
  console.log('QR Code gerado. Escaneie com seu WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('Autenticado com sucesso no WhatsApp!');
});

client.on('ready', () => {
  console.log('Bot pronto para atender!');
});

// Função para converter áudio para formato compatível com a API OpenAI
async function convertAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`Convertendo áudio de ${inputPath} para ${outputPath}`);

    ffmpeg(inputPath)
      .output(outputPath)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .audioChannels(1)
      .audioFrequency(16000) // Whisper funciona melhor com 16kHz
      .toFormat('mp3')
      .on('start', (commandLine) => {
        console.log('FFmpeg iniciado com comando:', commandLine);
      })
      .on('progress', (progress) => {
        console.log(`Progresso da conversão: ${progress.percent}%`);
      })
      .on('end', () => {
        console.log('Conversão de áudio concluída com sucesso');
        resolve();
      })
      .on('error', (err) => {
        console.error('Erro na conversão de áudio:', err);
        reject(err);
      })
      .run();
  });
}

// Registrar primeiras interações para buscar mensagem de boas-vindas
const userInteractions = new Map();

// Enviar mensagem para a API
async function sendToAPI(userPhone, message, isAudio = false, messageType = 'text') {
  try {
    console.log(`[${new Date().toISOString()}] Iniciando envio para API: ${userPhone}`);
    const apiStartTime = Date.now();
    console.log(`Enviando para API: ${API_URL}/message - Telefone: ${userPhone}, Tipo: ${messageType}, É áudio: ${isAudio}`);

    const response = await axios.post(`${API_URL}/message`, {
      phone: userPhone,
      message: message,
      isAudio: isAudio,
      messageType: messageType,
      isFirstMessage: !userInteractions.has(userPhone),
      timestamp: new Date().toISOString()
    });

    // Registrar a resposta completa para debug
    console.log('Resposta da API recebida:', {
      success: response.data.success,
      hasText: !!response.data.text,
      hasAudio: !!response.data.audio,
      hasImage: !!response.data.image,
      textSample: response.data.text ? response.data.text.substring(0, 50) + '...' : null
    });

    // Registrar que o usuário já interagiu
    if (!userInteractions.has(userPhone)) {
      userInteractions.set(userPhone, true);
    }

    return response.data;
  } catch (error) {
    console.error('Erro ao enviar mensagem para API:', error.message);
    if (error.response) {
      console.error('Detalhes da resposta de erro:', error.response.data);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

// Download de mídia da API
async function downloadMedia(url, type) {
  try {
    console.log(`Iniciando download de ${type} de: ${url}`);

    // Verificar se a URL é relativa (começa com /)
    const fullUrl = url.startsWith('/')
      ? `${API_URL.replace('/api', '')}${url}`
      : url;

    console.log(`URL completa para download: ${fullUrl}`);

    // Baixar arquivo da API
    const response = await axios({
      method: 'get',
      url: fullUrl,
      responseType: 'arraybuffer',
      timeout: 30000, // 30 segundos de timeout
      headers: {
        'Accept': '*/*' // Aceitar qualquer tipo de conteúdo
      }
    });

    // Verificar a resposta
    if (!response.data || response.data.length === 0) {
      console.error('Download concluído, mas sem dados');
      return null;
    }

    console.log(`Download concluído. Tamanho: ${response.data.length} bytes, Tipo: ${response.headers['content-type'] || 'não especificado'}`);

    // Gerar nome de arquivo único
    const extension = type === 'audio' ? 'mp3' : 'jpg';
    const filename = `${MEDIA_PATH}/${type}_${Date.now()}.${extension}`;

    // Garantir que o diretório existe
    if (!fs.existsSync(MEDIA_PATH)) {
      fs.mkdirSync(MEDIA_PATH, { recursive: true });
    }

    // Salvar arquivo
    fs.writeFileSync(filename, response.data);
    console.log(`Arquivo salvo em: ${filename}`);

    // Verificar o arquivo salvo
    const stats = fs.statSync(filename);
    console.log(`Verificação do arquivo: ${filename}, tamanho: ${stats.size} bytes`);

    if (stats.size === 0) {
      console.error('Arquivo salvo está vazio');
      return null;
    }

    return filename;
  } catch (error) {
    console.error(`Erro detalhado ao fazer download de ${type}:`, error);
    if (error.response) {
      console.error(`Status: ${error.response.status}, Dados: ${typeof error.response.data}`);
    }
    return null;
  }
}

// Função para verificar se a string é um JSON válido
function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

// Função para extrair botões da resposta do LLM
function extractFormattedContent(text) {
  // Padrão para identificar botões: <buttons>{"title": "Título", "buttons": [{"body": "Opção 1"}, {"body": "Opção 2"}]}</buttons>
  const buttonMatch = text.match(/<buttons>(.*?)<\/buttons>/s);

  if (buttonMatch && buttonMatch[1] && isValidJSON(buttonMatch[1])) {
    const buttonData = JSON.parse(buttonMatch[1]);
    // Remover a tag de botões do texto
    const cleanedText = text.replace(/<buttons>.*?<\/buttons>/s, '').trim();
    return {
      text: cleanedText,
      buttons: buttonData
    };
  }

  return { text, buttons: null };
}

/**
 * Função para tratar requisições específicas de áudio
 * @param {string} userPhone - Número de telefone do usuário
 * @param {string} message - Mensagem do usuário
 * @returns {Promise<boolean>} - true se processou pedido de áudio, false caso contrário
 */
async function handleAudioRequest(userPhone, message) {
  try {
    // Verificar se é um pedido explícito de áudio
    if (!message.toLowerCase().includes('audio') &&
      !message.toLowerCase().includes('áudio') &&
      !message.toLowerCase().includes('ouvir') &&
      !message.toLowerCase().includes('escutar')) {
      return false;
    }

    console.log(`Detectado pedido de áudio de ${userPhone}: ${message}`);

    // Verificar se é um pedido de áudio para a confirmação do pedido
    const isConfirmationAudio =
      message.toLowerCase().includes('confirmação') ||
      message.toLowerCase().includes('confirmado') ||
      message.toLowerCase().includes('pedido');

    if (isConfirmationAudio) {
      console.log('Solicitando áudio de confirmação de pedido da API');

      // Solicitar áudio da API - sem conversão
      const response = await axios.post(`${API_URL}/message`, {
        phone: userPhone,
        message: "Por favor gere um áudio da confirmação do pedido",
        isAudio: false,
        messageType: 'command_audio',
        isFirstMessage: false,
        timestamp: new Date().toISOString()
      });

      // Verificar se a API retornou um áudio
      if (response.data && response.data.audio) {
        console.log('API retornou URL de áudio:', response.data.audio);

        // Baixar o áudio no formato original
        const audioPath = await downloadMedia(response.data.audio, 'audio');
        if (audioPath) {
          console.log(`Áudio baixado para: ${audioPath}`);

          // Enviar o áudio sem conversão
          const media = MessageMedia.fromFilePath(audioPath);
          await client.sendMessage(userPhone, media, {
            sendAudioAsVoice: true,
            mimetype: 'audio/mp3' // Formato usado pelo WhatsApp
          });

          // Limpar arquivo temporário
          try {
            fs.unlinkSync(audioPath);
            console.log('Arquivo temporário removido');
          } catch (err) {
            console.error('Erro ao limpar arquivo temporário:', err);
          }

          return true;
        }
      } else {
        // Se a API não retornou áudio, enviar mensagem de texto explicando
        await client.sendMessage(userPhone,
          "Desculpe, não consegui gerar o áudio da confirmação neste momento. " +
          "Posso confirmar que seu pedido foi registrado e será entregue em aproximadamente 50 minutos."
        );
        return true;
      }
    }

    // Se chegou aqui, não processou o pedido de áudio específico
    return false;
  } catch (error) {
    console.error('Erro ao processar pedido de áudio:', error);
    // Enviar mensagem de erro para o usuário
    await client.sendMessage(userPhone,
      "Desculpe, encontrei um problema ao processar seu pedido de áudio. " +
      "Seu pedido foi registrado normalmente e será entregue conforme confirmado anteriormente."
    );
    return true;
  }
}

// Função para criar botões do WhatsApp
function createButtons(buttonData) {
  if (!buttonData || !buttonData.title || !buttonData.buttons || !Array.isArray(buttonData.buttons)) {
    return null;
  }

  const button = new Buttons(
    buttonData.title,
    buttonData.buttons.map(b => ({ body: b.body })),
    buttonData.title,
    buttonData.footer || ''
  );

  return button;
}

// Processar mensagens recebidas
client.on('message', async (message) => {
  try {
    const messageStartTime = Date.now();
    console.log(`[${new Date().toISOString()}] Mensagem recebida de ${message.from}. ID: ${message.id.id}`);
    // Ignorar mensagens de grupos
    const chat = await message.getChat();
    if (chat.isGroup) return;

    // Extrair informações da mensagem
    const userPhone = message.from;

    // Verificar tipo de mídia
    if (message.hasMedia) {
      const media = await message.downloadMedia();

      // Se for áudio ou nota de voz
      if (message.type === 'audio' || message.type === 'ptt') {
        await processAudioMessage(userPhone, media);
        return;
      }

      // Se for outro tipo de mídia, enviar para a API informando o tipo
      await processTextMessage(userPhone, `[${message.type}]`);
      return;
    }

    // Processar mensagem de texto normal
    await processTextMessage(userPhone, message.body);

  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    try {
      // Enviar para API o erro (para logging)
      const errorResponse = await sendToAPI(message.from, 'ERRO: ' + error.message, false, 'error');
      // Se a API retornar uma mensagem de erro personalizada, usar ela, senão usar mensagem genérica
      const errorMessage = errorResponse.text || 'Desculpe, ocorreu um erro. Por favor, tente novamente mais tarde.';
      await client.sendMessage(message.from, errorMessage);
    } catch (e) {
      console.error('Não foi possível enviar mensagem de erro:', e);
    }
  }
});
// A função processTextMessage deve ficar assim:
async function processTextMessage(userPhone, text) {
  // Conjunto para rastrear imagens já enviadas
  const sentImages = new Set();

  try {
    // Verificar primeiro se é um pedido específico de áudio
    const audioProcessed = await handleAudioRequest(userPhone, text);
    if (audioProcessed) {
      console.log('Pedido de áudio processado com sucesso');
      return;
    }

    // Enviar para a API e obter resposta
    const response = await sendToAPI(userPhone, text);

    // Extrair referências de imagens do texto da resposta (se necessário)
    const imageReferences = [];
    if (response.text) {
      const imageRegex = /\[IMAGE_FORMAT\](.*?)\[\/END\]/g;
      let imageMatch;
      while ((imageMatch = imageRegex.exec(response.text)) !== null) {
        if (imageMatch[1] && imageMatch[1].trim()) {
          imageReferences.push({
            id: imageMatch[1].trim(),
            processed: false
          });
        }
      }
    }

    // Processar resposta da API
    if (response.success) {
      console.log(`Iniciando envio de respostas para WhatsApp: ${userPhone}`);

      // Processar texto (blocos [TEXT_FORMAT])
      if (response.text) {
        // Extrair e enviar blocos de texto
        const textBlocks = response.text.match(/\[TEXT_FORMAT\]([\s\S]*?)\[\/END\]/g) || [];
        for (const block of textBlocks) {
          const cleanText = block.replace(/\[TEXT_FORMAT\]|\[\/END\]/g, '').trim();
          if (cleanText) {
            await client.sendMessage(userPhone, cleanText);
          }
        }
      }

      if (response.audio) {
        try {
          console.log('Processando áudio da resposta:', response.audio);
          
          // Verificar se a URL é relativa (começa com /)
          const fullUrl = response.audio.startsWith('/')
            ? `${API_URL.replace('/api', '')}${response.audio}`
            : response.audio;
          
          console.log('URL completa do áudio:', fullUrl);
          
          // Download do áudio
          const audioPath = await downloadMedia(response.audio, 'audio');
          
          if (audioPath) {
            console.log(`Áudio baixado para: ${audioPath}`);
            
            // Verificar arquivo
            const stats = fs.statSync(audioPath);
            console.log(`Tamanho do arquivo de áudio: ${stats.size} bytes`);
            
            if (stats.size > 0) {
              // Enviar o áudio
              const media = MessageMedia.fromFilePath(audioPath);
              await client.sendMessage(userPhone, media, {
                sendAudioAsVoice: true,
                mimetype: 'audio/mp3'
              });
              
              console.log('Áudio enviado com sucesso para WhatsApp');
            } else {
              console.error('Arquivo de áudio tem tamanho zero');
            }
            
            // Limpar arquivo temporário
            try {
              fs.unlinkSync(audioPath);
              console.log('Arquivo temporário de áudio removido');
            } catch (cleanupError) {
              console.error('Erro ao remover arquivo temporário:', cleanupError);
            }
          } else {
            console.error('Falha ao baixar o áudio');
            
            // Tentativa alternativa de download e envio
            try {
              console.log('Tentando método alternativo de download de áudio...');
              
              const response = await axios({
                method: 'get',
                url: fullUrl,
                responseType: 'arraybuffer',
                timeout: 30000
              });
              
              if (response.data && response.data.length > 0) {
                console.log(`Áudio baixado com sucesso pelo método alternativo. Tamanho: ${response.data.length} bytes`);
                
                // Salvar temporariamente
                const altAudioPath = `${MEDIA_PATH}/alt_audio_${Date.now()}.mp3`;
                
                // Garantir que o diretório existe
                if (!fs.existsSync(MEDIA_PATH)) {
                  fs.mkdirSync(MEDIA_PATH, { recursive: true });
                }
                
                // Salvar o arquivo
                fs.writeFileSync(altAudioPath, response.data);
                
                // Verificar arquivo
                if (fs.existsSync(altAudioPath) && fs.statSync(altAudioPath).size > 0) {
                  // Criar mídia e enviar
                  const media = MessageMedia.fromFilePath(altAudioPath);
                  await client.sendMessage(userPhone, media, {
                    sendAudioAsVoice: true,
                    mimetype: 'audio/mp3'
                  });
                  
                  console.log('Áudio enviado com sucesso via método alternativo');
                  
                  // Limpar arquivo temporário
                  fs.unlinkSync(altAudioPath);
                } else {
                  console.error('Arquivo alternativo de áudio inválido');
                }
              } else {
                console.error('Download alternativo de áudio falhou');
              }
            } catch (altError) {
              console.error('Erro no método alternativo de áudio:', altError);
            }
          }
        } catch (audioError) {
          console.error('Erro ao processar áudio:', audioError);
        }
      }

      // Processar imagem principal (se houver e não foi enviada ainda)
      if (response.image && !sentImages.has(response.image)) {
        try {
          if (response.image.startsWith('data:image')) {
            const matches = response.image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              const mediaType = matches[1];
              const mediaData = matches[2];
              const caption = response.imageCaption || '';

              const media = new MessageMedia(mediaType, mediaData);
              await client.sendMessage(userPhone, media, { caption });
              console.log('Imagem principal enviada com sucesso');

              // Marcar a imagem como enviada
              sentImages.add(response.image);
            }
          } else {
            const imagePath = await downloadMedia(response.image, 'image');
            if (imagePath) {
              const media = MessageMedia.fromFilePath(imagePath);
              await client.sendMessage(userPhone, media, { caption: response.imageCaption || '' });

              // Marcar a imagem como enviada
              sentImages.add(response.image);

              // Limpar arquivo temporário
              fs.unlinkSync(imagePath);
            }
          }
        } catch (imageError) {
          console.error('Erro ao enviar imagem principal:', imageError);
        }
      }

      // Processar imagens adicionais do array allImages
      if (response.allImages && response.allImages.length > 0) {
        for (const imgData of response.allImages) {
          if (imgData.url && !sentImages.has(imgData.url)) {
            try {
              if (imgData.url.startsWith('data:image')) {
                const matches = imgData.url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                  const mediaType = matches[1];
                  const mediaData = matches[2];
                  const caption = imgData.caption || '';

                  const media = new MessageMedia(mediaType, mediaData);
                  await client.sendMessage(userPhone, media, { caption });
                  console.log(`Imagem adicional enviada: ${imgData.id}`);

                  // Marcar a imagem como enviada
                  sentImages.add(imgData.url);
                }
              } else {
                const imagePath = await downloadMedia(imgData.url, 'image');
                if (imagePath) {
                  const media = MessageMedia.fromFilePath(imagePath);
                  await client.sendMessage(userPhone, media, { caption: imgData.caption || '' });

                  // Marcar a imagem como enviada
                  sentImages.add(imgData.url);

                  // Limpar arquivo temporário
                  fs.unlinkSync(imagePath);
                }
              }
            } catch (error) {
              console.error(`Erro ao processar imagem adicional ${imgData.id}:`, error);
            }
          }
        }
      }

      // Processar TODAS as imagens adicionais das referências (imageReferences)
      if (imageReferences.length > 0) {
        console.log(`Processando ${imageReferences.length} imagens adicionais`);

        for (let i = 0; i < imageReferences.length; i++) {
          const imgRef = imageReferences[i];

          // Pular a primeira imagem se já tiver sido enviada como imagem principal
          if (i === 0 && response.image && response.imageCaption &&
            (response.imageCaption.toLowerCase().includes(imgRef.id) ||
              imgRef.id.includes(response.imageCaption.toLowerCase()))) {
            console.log(`Imagem ${imgRef.id} já enviada como imagem principal, pulando.`);
            imgRef.processed = true;
            continue;
          }

          // Se ainda não processamos esta imagem, vamos processá-la agora
          if (!imgRef.processed && !sentImages.has(imgRef.id)) {
            try {
              console.log(`Processando imagem adicional ${i + 1}/${imageReferences.length}: ${imgRef.id}`);

              // Buscar a imagem diretamente no banco de dados ou de onde ela está armazenada
              if (imgRef.id === 'cardapio' || imgRef.id === 'menu') {
                console.log(`Pulando processamento de CardapioItem para o cardápio`);
                
                // Buscar diretamente a configuração do bot para obter a imagem do cardápio
                try {
                  const configResponse = await axios.get(`${API_URL}/bot-config`);
                  if (configResponse.data && configResponse.data.menuImage) {
                    const menuImage = configResponse.data.menuImage;
                    const menuCaption = configResponse.data.menuImageCaption || 'Cardápio';
                    
                    console.log(`Imagem do cardápio obtida da configuração do bot`);
                    
                    // Verificar se é base64 válido
                    if (menuImage && menuImage.startsWith('data:image')) {
                      const matches = menuImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                      if (matches && matches.length === 3) {
                        try {
                          const mediaType = matches[1];
                          const mediaData = matches[2];
                          
                          // Criar objeto de mídia e enviar
                          const media = new MessageMedia(mediaType, mediaData);
                          await client.sendMessage(userPhone, media, { caption: menuCaption });
                          
                          console.log(`Cardápio enviado com sucesso`);
                          
                          // Marcar como processado
                          sentImages.add(imgRef.id);
                          imgRef.processed = true;
                        } catch (mediaError) {
                          console.error(`Erro ao processar mídia do cardápio:`, mediaError);
                        }
                      } else {
                        console.error(`Formato base64 inválido para imagem do cardápio`);
                      }
                    } else {
                      console.error(`A imagem do cardápio não está em formato base64 válido`);
                    }
                  } else {
                    console.error(`Imagem do cardápio não encontrada na configuração`);
                  }
                } catch (configError) {
                  console.error(`Erro ao buscar configuração do bot:`, configError);
                }
                
                // Pular o resto do processamento para este item
                continue;
              }

              // Se não encontrou pelo identificador exato, tentar buscar pelo nome da pizza no ID
              if (!item && imgRef.id.includes('pizza-')) {
                const pizzaName = imgRef.id.split('_pizza-')[1] || imgRef.id.split('-pizza-')[1];
                if (pizzaName) {
                  item = await CardapioItem.findOne({
                    nome: { $regex: new RegExp(pizzaName, 'i') },
                    disponivel: true
                  });
                }
              }

              // Se ainda não encontrou, tentar uma busca mais ampla
              if (!item) {
                item = await CardapioItem.findOne({
                  $or: [
                    { identificador: { $regex: new RegExp(imgRef.id, 'i') } },
                    { nome: { $regex: new RegExp(imgRef.id, 'i') } }
                  ],
                  disponivel: true
                });
              }

              if (!item || !item.imagemGeral) {
                console.error(`Imagem não encontrada para ID: ${imgRef.id}`);
                continue;
              }

              const imageUrl = item.imagemGeral;
              const caption = `*${item.nome}*: ${item.descricao || ''}`;

              // Enviar a imagem com um atraso para garantir a ordem
              await new Promise(r => setTimeout(r, 500));

              // Processar e enviar esta imagem
              if (imageUrl.startsWith('data:image')) {
                // Processar base64
                const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                  const mediaType = matches[1];
                  const mediaData = matches[2];
                  const media = new MessageMedia(mediaType, mediaData);
                  await client.sendMessage(userPhone, media, { caption });
                  console.log(`Imagem adicional ${imgRef.id} enviada via base64`);

                  // Marcar a imagem como enviada
                  sentImages.add(imgRef.id);
                  imgRef.processed = true;
                }
              } else {
                // Processar URL
                const imagePath = await downloadMedia(imageUrl, 'image');
                if (imagePath) {
                  const media = MessageMedia.fromFilePath(imagePath);
                  await client.sendMessage(userPhone, media, { caption });
                  console.log(`Imagem adicional ${imgRef.id} enviada via arquivo`);

                  // Marcar a imagem como enviada
                  sentImages.add(imgRef.id);
                  imgRef.processed = true;

                  // Limpar arquivo temporário
                  fs.unlinkSync(imagePath);
                }
              }
            } catch (error) {
              console.error(`Erro ao processar imagem ${imgRef.id}:`, error);
            }
          }
        }

        // Verificar se alguma imagem não foi processada
        const unprocessedImages = imageReferences.filter(img => !img.processed);
        if (unprocessedImages.length > 0) {
          console.warn(`${unprocessedImages.length} imagens não foram processadas: ${unprocessedImages.map(img => img.id).join(', ')}`);
        }
      }
    } else {
      // Em caso de erro na API
      const errorMessage = response.error || 'Desculpe, tive um problema ao processar sua mensagem.';
      await client.sendMessage(userPhone, errorMessage);
    }
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    await client.sendMessage(userPhone, 'Desculpe, ocorreu um erro ao processar sua mensagem.');
  } finally {
    // Limpar o conjunto de imagens enviadas no final da função
    sentImages.clear();
    console.log('Conjunto de imagens enviadas foi limpo.');
  }
}

// Processar mensagem de áudio
async function processAudioMessage(userPhone, media) {
  console.log(`Nova mensagem de áudio de ${userPhone}`);

  try {
    // Verificar se a API Key da OpenAI está configurada
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("API key da OpenAI não configurada");
    }

    // Salvar o áudio temporariamente no formato original (OGG)
    const audioPath = `${MEDIA_PATH}/audio_received_${Date.now()}.ogg`;

    // Verificar se o diretório existe
    if (!fs.existsSync(MEDIA_PATH)) {
      fs.mkdirSync(MEDIA_PATH, { recursive: true });
    }

    // Garantir que media.data seja uma string base64 válida
    if (!media || !media.data) {
      throw new Error("Dados de áudio inválidos");
    }

    const audioDataBuffer = Buffer.from(media.data, 'base64');
    fs.writeFileSync(audioPath, audioDataBuffer);

    console.log(`Áudio salvo em: ${audioPath}`);

    // Obter informações do arquivo para verificação
    const fileStats = fs.statSync(audioPath);
    console.log(`Tamanho do arquivo: ${fileStats.size} bytes`);

    if (fileStats.size === 0) {
      throw new Error("Arquivo de áudio está vazio");
    }

    console.log("Iniciando transcrição com OpenAI Whisper...");

    try {
      // Criar um arquivo de leitura para o áudio
      const transcript = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-1",
        response_format: "json"
      });

      console.log(`Áudio transcrito com sucesso: ${transcript.text}`);

      // Enviar a transcrição para a API como se fosse uma mensagem de texto
      if (transcript && transcript.text) {
        await processTextMessage(userPhone, transcript.text);
      } else {
        throw new Error("Transcrição vazia ou inválida");
      }
    } catch (transcriptionError) {
      console.error('Erro na transcrição:', transcriptionError);
      throw transcriptionError;
    }

    // Limpar arquivo temporário
    try {
      fs.unlinkSync(audioPath);
      console.log(`Arquivo temporário ${audioPath} removido com sucesso`);
    } catch (cleanupError) {
      console.error("Erro ao limpar arquivo temporário:", cleanupError);
    }
  } catch (error) {
    console.error('Erro ao processar áudio:', error);
    // Enviar para a API o erro de áudio para obter resposta personalizada
    const errorResponse = await sendToAPI(userPhone, "ERRO_ÁUDIO", false, 'error_audio');
    const errorMessage = errorResponse.text || 'Não consegui entender o áudio. Pode tentar novamente ou enviar uma mensagem de texto?';
    await client.sendMessage(userPhone, errorMessage);
  }
}

// Inicializar o cliente
client.initialize();

// Verificar conexão com a API periodicamente
setInterval(async () => {
  try {
    await axios.get(`${API_URL}/health`);
    console.log('API está online');
  } catch (error) {
    console.error('Erro ao conectar com a API:', error);
  }
}, 60000); // Verificar a cada minuto