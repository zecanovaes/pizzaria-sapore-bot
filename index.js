const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const ngrok = require('ngrok');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const dotenv = require('dotenv');
const axios = require('axios');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');
const cloudinary = require('cloudinary').v2;
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia, Buttons } = require('whatsapp-web.js');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { exec } = require('child_process');

// Configurar ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Carregar variáveis de ambiente
dotenv.config();

// Definir caminhos para mídia e autenticação
const MEDIA_PATH = process.env.ORACLE_CLOUD
  ? path.join(__dirname, 'media')
  : './media';

const AUTH_PATH = process.env.ORACLE_CLOUD
  ? path.join(__dirname, '.wwebjs_auth')
  : './.wwebjs_auth';

// Criar diretórios necessários
if (!fs.existsSync(MEDIA_PATH)) {
  fs.mkdirSync(MEDIA_PATH, { recursive: true });
}
if (!fs.existsSync(AUTH_PATH)) {
  fs.mkdirSync(AUTH_PATH, { recursive: true });
}

// Verificar ambiente de produção
const isProduction = process.env.NODE_ENV === 'production' || process.env.ORACLE_CLOUD === 'true';

// ======== CONFIGURAÇÃO MONGOOSE ==========
mongoose.set('strictQuery', false);

// Importar modelos
const {
  BotConfig,
  PizzariaHistoria,
  CardapioItem,
  Categoria,
  FormaPagamento,
  Conversa,
  Pedido,
  DeliveryConfig,
  ApiKeys
} = require('./models');

// ======== CONFIGURAÇÃO CLOUDINARY ==========
cloudinary.config({
  cloud_name: 'dg4zmbjmt',
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET
});

// ======== CONFIGURAÇÃO EXPRESS ==========
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'http://localhost:3001';

// Middleware Express
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(bodyParser.json());
app.use('/api/media', express.static(path.join(__dirname, 'public', 'media')));

// Configurar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configurar upload de arquivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const mediaDir = path.join(__dirname, 'public', 'media');
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }
    cb(null, mediaDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ storage: storage });

// ======== CONFIGURAÇÃO WHATSAPP BOT ==========
// Configurações do Puppeteer para o WhatsApp
const puppeteerOptions = {
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--single-process'
  ],
  headless: true,
  executablePath: '/usr/bin/google-chrome-stable'
};

// Inicializar cliente WhatsApp com estas opções
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
  puppeteer: puppeteerOptions,
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2332.15.html'
  }
});

// Registrar primeiras interações para buscar mensagem de boas-vindas
const userInteractions = new Map();

// Armazenamento temporário de dados de pedido
const tempPedidoData = new Map();

// Cache de dados comuns
const dataCache = {
  botConfig: null,
  historia: null,
  cardapioBasico: null,
  formasPagamento: null,
  lastUpdated: 0
};

// ======== FUNÇÕES COMPARTILHADAS ==========

// Inicializar banco de dados com dados padrão, se necessário
async function initialize() {
  try {
    // Conectar ao MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Conectado ao MongoDB');
    
    // Inicializar o cliente WhatsApp
    console.log('🔄 Inicializando cliente WhatsApp...');
    client.initialize();
    
    // A função startServer será chamada quando o cliente estiver pronto
  } catch (error) {
    console.error('❌ Erro ao inicializar aplicação:', error);
    process.exit(1);
  }
}

// Iniciar a aplicação
initialize();

async function setupNgrok(port) { 
  try {
    // Conectar ao ngrok e criar um túnel para a porta especificada
    const url = await ngrok.connect({
      addr: port,
      region: 'us', // Você pode mudar para 'eu', 'ap', 'au', 'sa', 'jp', 'in'
    });
    
    console.log(`✅ Túnel ngrok criado: ${url}`);
    console.log(`🔍 Acesse o QR code em: ${url}/qrcode`);
    
    return url;
  } catch (error) {
    console.error('❌ Erro ao iniciar ngrok:', error);
    return null;
  }
}

// Função para manter o bot rodando e evitar desligamento em VMs
function keepAlive() {
  setInterval(() => {
    console.log(`[BOT ATIVO] ${new Date().toISOString()}`);

    // Rodar um comando "heartbeat" para evitar que a sessão SSH seja encerrada
    exec('echo "Bot ativo"', (err, stdout, stderr) => {
      if (err) {
        console.error("Erro no keepAlive:", stderr);
      }
    });
  }, 30 * 60 * 1000); // Log a cada 30 minutos
}

// Download de mídia
async function downloadMedia(url, type) {
  try {
    console.log(`Iniciando download de ${type} de: ${url}`);

    // Verificar se a URL é relativa (começa com /)
    const fullUrl = url.startsWith('/')
      ? `${API_URL.replace('/api', '')}${url}`
      : url;

    console.log(`URL completa para download: ${fullUrl}`);

    // Baixar arquivo
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

// Função para obter dados com cache
async function getCachedData() {
  const now = Date.now();

  try {
    console.log('[CACHE] Verificando dados em cache...');

    // Se não temos nada em cache ou passou muito tempo, buscar tudo
    if (!dataCache.botConfig || !dataCache.historia || !dataCache.formasPagamento ||
      !dataCache.cardapioItems || now - dataCache.lastUpdated > 300000) {

      console.log('[CACHE] Carregando dados essenciais...');

      // Buscar apenas os campos necessários
      dataCache.botConfig = await BotConfig.findOne().select('nome descricao personalidade systemPrompt welcomeMessage');
      dataCache.historia = await PizzariaHistoria.findOne().select('titulo conteudo');
      dataCache.formasPagamento = await FormaPagamento.find({ ativo: true }).select('nome requerTroco ativo');

      // Carregar cardápio sem as imagens para economizar memória e tempo
      console.log('[CACHE] Carregando cardápio sem imagens...');
      dataCache.cardapioItems = await CardapioItem.find({ disponivel: true })
        .select('nome descricao categoria preco identificador inspiracao');

      dataCache.lastUpdated = now;
      console.log('[CACHE] Dados carregados com sucesso');
    } else {
      console.log('[CACHE] Usando dados em cache (última atualização:', new Date(dataCache.lastUpdated).toISOString(), ')');
    }

    return {
      botConfig: dataCache.botConfig,
      historia: dataCache.historia,
      formasPagamento: dataCache.formasPagamento,
      cardapioItems: dataCache.cardapioItems
    };
  } catch (error) {
    console.error('[CACHE] Erro ao carregar cache:', error);

    // Em caso de erro, retornar objetos vazios para evitar exceções
    return {
      botConfig: null,
      historia: null,
      formasPagamento: [],
      cardapioItems: []
    };
  }
}

// Validação e detecção de endereço 
async function detectAndValidateCEP(message) {
  const cepMatch = message.match(/(\d{5})-?\s*?(\d{3})/);
  if (cepMatch) {
    const cep = cepMatch[1] + cepMatch[2];
    console.log(`CEP detectado: ${cep}`);

    try {
      // Consultar a API de CEP
      const response = await axios.get(`https://brasilapi.com.br/api/cep/v2/${cep}`);
      if (response.data) {
        const cepData = response.data;
        console.log("Dados do CEP:", JSON.stringify(cepData));

        // Formatar o endereço
        const formattedAddress = `${cepData.street}, ${cepData.neighborhood}, ${cepData.city} - ${cepData.state}, ${cepData.cep}`;
        console.log("Endereço formatado:", formattedAddress);

        return {
          formattedAddress,
          components: {
            street: cepData.street,
            neighborhood: cepData.neighborhood,
            city: cepData.city,
            state: cepData.state,
            cep: cepData.cep
          }
        };
      }
    } catch (error) {
      console.error("Erro ao consultar API do CEP:", error);
    }
  }
  return null;
}

// Validação completa de endereço
async function validateAddress(address, isQuery = false) {
  try {
    // Verificar se o endereço está vazio
    if (!address || address.trim() === '') {
      return {
        valid: false,
        message: "Por favor, informe um endereço para entrega."
      };
    }

    // Extrair CEP - buscar padrão de 8 dígitos (com ou sem hífen)
    const cepMatch = address.match(/\b\d{5}-?\d{3}\b/g);

    if (cepMatch) {
      const cep = cepMatch[0].replace('-', '');
      console.log(`CEP encontrado: ${cep}, consultando API...`);

      try {
        // Consultar API de CEP
        const response = await axios.get(`https://brasilapi.com.br/api/cep/v2/${cep}`);

        if (response.data) {
          const cepData = response.data;
          console.log("Dados do CEP:", JSON.stringify(cepData));

          // Verificar se está em São Paulo
          if (cepData.city === "São Paulo" && cepData.state === "SP") {
            // Extrair número do endereço, se existir
            const numeroMatch = address.match(/(R\.|Rua|Av\.|Avenida|Al\.|Alameda)\s+[^,]+,\s*(\d+)/i);
            const numero = numeroMatch ? numeroMatch[2] : '';

            // Formatação padronizada do endereço
            let formattedAddress = cepData.street || '';
            if (numero) {
              formattedAddress += `, ${numero}`;
            }
            if (cepData.neighborhood) {
              formattedAddress += `, ${cepData.neighborhood}`;
            }
            formattedAddress += `, ${cepData.city || ''} - ${cepData.state || ''}`;
            if (cep) {
              formattedAddress += `, ${cep}`;
            }

            console.log("Endereço formatado:", formattedAddress);

            // Verificar se tem número para determinar validade
            if (numero || isQuery) {
              return {
                valid: true,
                formattedAddress,
                components: {
                  streetNumber: numero,
                  street: cepData.street,
                  sublocality: cepData.neighborhood,
                  locality: cepData.city,
                  administrativeArea: cepData.state,
                  postalCode: cep
                },
                message: `Ótimo! ${formattedAddress} faz parte da nossa rota de entregas!`,
                fromCep: true
              };
            } else {
              return {
                valid: false,
                requiresNumber: true,
                streetName: cepData.street,
                formattedAddress: formattedAddress,
                components: {
                  streetNumber: numero,
                  street: cepData.street,
                  sublocality: cepData.neighborhood,
                  locality: cepData.city,
                  administrativeArea: cepData.state,
                  postalCode: cep
                },
                message: `Preciso do NÚMERO do seu endereço na ${cepData.street} para prosseguir com a entrega.`,
                fromCep: true
              };
            }
          } else {
            return {
              valid: false,
              message: `Desculpe, só entregamos em São Paulo capital. Este endereço (${cepData.city}-${cepData.state}) não está na nossa área de entrega.`
            };
          }
        }
      } catch (cepError) {
        console.error("Erro ao consultar API do CEP:", cepError);
        return {
          valid: false,
          message: "Não consegui encontrar este endereço. Você poderia informar um CEP válido de São Paulo?"
        };
      }
    }

    // Fallback para o caso da API não retornar resultados
    // Se for consulta, retornar mensagem negativa
    if (isQuery) {
      return {
        valid: false,
        message: "Não consegui encontrar este endereço. Você poderia informar um CEP válido de São Paulo?"
      };
    }

    // Se não for consulta e tiver número, aceitar o endereço
    if (/\d+/.test(address)) {
      return {
        valid: true,
        formattedAddress: address,
        message: `Endereço registrado: ${address}`
      };
    } else {
      // Se não tiver número, pedir número
      const ruaMatch = address.match(/\b(R\.|Rua|Av\.|Avenida|Al\.|Alameda)\s+([^,]+)/i);
      const nomeRua = ruaMatch ? ruaMatch[0] : "endereço mencionado";

      return {
        valid: false,
        requiresNumber: true,
        streetName: nomeRua,
        message: `Preciso do NÚMERO do seu endereço na ${nomeRua} para prosseguir com a entrega.`
      };
    }
  } catch (error) {
    console.error('Erro ao validar endereço:', error);
    return {
      valid: true,
      formattedAddress: address,
      message: "Endereço registrado. Se houver algum problema com a entrega, entraremos em contato."
    };
  }
}

// Obtém o prompt do sistema a partir do banco de dados
async function getSystemPromptFromDatabase(botConfig, historia, cardapioItems, formasPagamento, currentState, conversa = {}) {
  const promptStartTime = Date.now();
  console.log(`[${new Date().toISOString()}] Início da função getSystemPromptFromDatabase`);

  try {
    // Se não temos a história, buscar novamente do banco para garantir
    if (!historia || !historia.conteudo) {
      console.log('História não fornecida ou vazia, buscando do banco...');
      historia = await PizzariaHistoria.findOne();

      if (!historia || !historia.conteudo) {
        console.error('ALERTA: História da pizzaria não encontrada no banco de dados!');
      } else {
        console.log('História carregada com sucesso do banco de dados');
      }
    }

    // Buscar o prompt diretamente da configuração do bot
    if (botConfig && botConfig.systemPrompt) {
      // Obter o conteúdo da história (se disponível)
      const historiaContent = historia && historia.conteudo ? historia.conteudo : 'Informação não disponível';
      console.log('Tamanho do conteúdo da história:', historiaContent.length, 'caracteres');

      // Iniciar com o prompt base
      let prompt = botConfig.systemPrompt;

      // Log para debug dos dados de endereço
      if (conversa && conversa.addressData) {
        console.log("Dados de endereço disponíveis para montagem do prompt:", {
          formattedAddress: conversa.addressData.formattedAddress || "não disponível",
          components: typeof conversa.addressData.components === 'string'
            ? conversa.addressData.components
            : JSON.stringify(conversa.addressData.components || {})
        });
      } else {
        console.log("Nenhum dado de endereço disponível para montagem do prompt");
      }

      // Preparar valor do CEP com verificação segura
      let cepValue = 'Endereço não informado';
      if (conversa?.addressData?.components) {
        if (typeof conversa.addressData.components === 'string') {
          // Se for string, converter para objeto
          try {
            const componentsObj = JSON.parse(conversa.addressData.components);
            cepValue = componentsObj.cep || 'Endereço não informado';
            console.log(`CEP extraído de components (string): ${cepValue}`);
          } catch (e) {
            console.error('Erro ao fazer parse de components:', e);
          }
        } else {
          // Se já for objeto
          cepValue = conversa.addressData.components.cep || 'Endereço não informado';
          console.log(`CEP extraído de components (objeto): ${cepValue}`);
        }
      }

      // Substituir todos os placeholders conhecidos
      console.time('prompt_replacements');

      const replacements = {
        '{{BOT_NAME}}': botConfig.nome || 'Assistente',
        '{{BOT_DESCRIPTION}}': botConfig.descricao || 'Atendente da pizzaria',
        '{{PERSONALIDADE}}': botConfig.personalidade || '',
        '{{PROCEDIMENTO}}': botConfig.procedimento || '',
        '{{REGRAS}}': botConfig.regras || '',
        '{{HISTORIA}}': historiaContent,
        '{{CURRENT_STATE}}': currentState.toString(),
        '{{CURRENT_DATE}}': new Date().toISOString().split('T')[0],
        '{{ENDERECO_VALIDADO.cep}}': cepValue,
        '{{ENDERECO_VALIDADO.formattedAddress}}': conversa?.addressData?.formattedAddress || 'Endereço não informado'
      };

      // Log dos valores que serão usados para substituição
      console.log("Valores para substituição dos placeholders de endereço:");
      console.log(`- {{ENDERECO_VALIDADO.cep}} => "${replacements['{{ENDERECO_VALIDADO.cep}}']}"`);
      console.log(`- {{ENDERECO_VALIDADO.formattedAddress}} => "${replacements['{{ENDERECO_VALIDADO.formattedAddress}}']}"`);

      // Aplicar todas as substituições
      Object.entries(replacements).forEach(([placeholder, value]) => {
        if (prompt.includes(placeholder)) {
          prompt = prompt.replace(new RegExp(placeholder, 'g'), value);
          console.log(`Placeholder ${placeholder} substituído com sucesso`);
        }
      });

      console.timeEnd('prompt_replacements');

      // Adicionar informações de estado específicas
      if (currentState === 4) {
        prompt += `\n\nVOCÊ ESTÁ NO ESTADO DE COLETA DE ENDEREÇO.
        - Se o cliente já informou o nome da rua sem o número, pergunte SOMENTE o número.
        - Use exatamente este formato: "Qual é o NÚMERO do seu endereço na [rua mencionada]?"
        - NÃO prossiga para o próximo estado até ter um número de endereço.`;
      }
      else if (currentState === 5) {
        prompt += `\n\nVOCÊ ESTÁ NO ESTADO DE COLETA DE FORMA DE PAGAMENTO.
        - Pergunte APENAS qual a forma de pagamento desejada.
        - Mencione troco SOMENTE se o cliente escolher pagar em dinheiro.
        - Se o pagamento for VR, PIX ou cartão, NÃO mencione troco.`;
      }

      // Adicionar cardápio dinâmico se necessário
      if (prompt.includes('{{CARDAPIO}}') && cardapioItems.length > 0) {
        const cardapioText = formatCardapioForPrompt(cardapioItems);
        prompt = prompt.replace(/\{\{CARDAPIO\}\}/g, cardapioText);
        console.log('Placeholder {{CARDAPIO}} substituído com sucesso');
      }

      // Adicionar formas de pagamento se necessário
      if (prompt.includes('{{FORMAS_PAGAMENTO}}') && formasPagamento.length > 0) {
        const pagamentoText = formatPagamentoForPrompt(formasPagamento);
        prompt = prompt.replace(/\{\{FORMAS_PAGAMENTO\}\}/g, pagamentoText);
        console.log('Placeholder {{FORMAS_PAGAMENTO}} substituído com sucesso');
      }

      // Verificar se todos os placeholders foram substituídos
      const remainingPlaceholders = prompt.match(/\{\{([^}]+)\}\}/g);
      if (remainingPlaceholders) {
        console.error('ALERTA: Alguns placeholders não foram substituídos:', remainingPlaceholders);
      } else {
        console.log('Todos os placeholders foram substituídos com sucesso');
      }

      const promptEndTime = Date.now();
      console.log(`[${new Date().toISOString()}] getSystemPromptFromDatabase concluído em ${promptEndTime - promptStartTime}ms`);

      return prompt;
    }

    // Fallback para um prompt básico se não encontrar no banco
    return "Você é um atendente de pizzaria. Ajude o cliente a fazer seu pedido. NUNCA INVENTE informações sobre a pizzaria.";
  } catch (error) {
    console.error('Erro ao obter prompt do sistema:', error);
    return "Você é um atendente de pizzaria. Ajude o cliente a fazer seu pedido. NUNCA INVENTE informações sobre a pizzaria.";
  }
}

// Formatação de dados para o prompt
function formatCardapioForPrompt(items) {
  try {
    let result = '';

    // Agrupar por categoria
    const categorias = {};
    items.forEach(item => {
      const categoriaKey = item.categoria.toString();
      if (!categorias[categoriaKey]) {
        categorias[categoriaKey] = [];
      }
      categorias[categoriaKey].push(item);
    });

    // Formatar cada categoria
    Object.keys(categorias).forEach(categoria => {
      result += `\n${categoria}:\n`;
      categorias[categoria].forEach(item => {
        result += `- *${item.nome}*: ${item.descricao || ''} - R$${item.preco.toFixed(2)}\n`;
        if (item.inspiracao) {
          result += `  Inspiração: ${item.inspiracao}\n`;
        }
      });
    });

    return result;
  } catch (error) {
    console.error('Erro ao formatar cardápio:', error);
    return "Cardápio não disponível";
  }
}

function formatPagamentoForPrompt(pagamentos) {
  try {
    let result = '';

    pagamentos.forEach(forma => {
      result += `- ${forma.nome}${forma.requerTroco ? ' (pode precisar de troco)' : ''}\n`;
    });

    return result;
  } catch (error) {
    console.error('Erro ao formatar pagamentos:', error);
    return "Formas de pagamento não disponíveis";
  }
}

// Detecta pedidos por imagens específicas
function detectImageRequest(message) {
  message = message.toLowerCase();

  // Verifica se mensagem contém palavras-chave relacionadas a imagens
  const hasImageRequest = message.includes('imagem') ||
    message.includes('foto') ||
    message.includes('mostra') ||
    message.includes('mostrar') ||
    message.includes('ver') ||
    message.includes('veja') ||
    message.includes('como é');

  // Se não há pedido de imagem, retorna null imediatamente
  if (!hasImageRequest) {
    return null;
  }

  // Lista REAL das pizzas com seus identificadores corretos
  const pizzaTypes = [
    { name: 'amazonas', id: 'pizza-salgada_pizza-amazonas' },
    { name: 'porco & pinhão', id: 'pizza-salgada_pizza-porco-e-pinhao' },
    { name: 'porco e pinhão', id: 'pizza-salgada_pizza-porco-e-pinhao' },
    { name: 'porco e pinhao', id: 'pizza-salgada_pizza-porco-e-pinhao' },
    { name: 'tropicale', id: 'pizza-salgada_pizza-tropicale' },
    { name: 'napolitana paulistana', id: 'pizza-salgada_pizza-napolitana-paulistana' },
    { name: 'cerrado brasileiro', id: 'pizza-salgada_pizza-cerrado-brasileiro' },
    { name: 'caprese tropical', id: 'pizza-salgada_pizza-caprese-tropical' },
    { name: 'frutos do mar à paulista', id: 'pizza-salgada_pizza-frutos-do-mar-a-paulista' },
    { name: 'frutos do mar', id: 'pizza-salgada_pizza-frutos-do-mar-a-paulista' },
    { name: 'dolce banana', id: 'pizza-doce_pizza-dolce-banana' },
    { name: 'banana', id: 'pizza-doce_pizza-dolce-banana' }
  ];

  // Detectar pedido de cardápio
  if (message.includes('cardápio') ||
    message.includes('cardapio') ||
    message.includes('menu') ||
    (message.includes('opções') && message.includes('pizza'))) {
    return ['cardapio'];
  }

  // VERIFICAR PEDIDO DE MEIO A MEIO
  // Buscar termos que indicam pizza meio a meio
  if (message.includes('meio a meio') ||
    message.includes('metade') ||
    message.includes('meio') ||
    (message.includes('meia') && message.includes('meia'))) {

    console.log('Possível pedido de pizza meio a meio detectado');

    // Verificar todos os sabores para ver quais foram mencionados
    const saboresMencionados = [];

    for (const pizza of pizzaTypes) {
      if (message.includes(pizza.name)) {
        saboresMencionados.push(pizza);
      }
    }

    // Se dois ou mais sabores foram mencionados, provavelmente é um pedido meio a meio
    if (saboresMencionados.length >= 2) {
      console.log(`Encontrados ${saboresMencionados.length} sabores: ${saboresMencionados.map(s => s.name).join(', ')}`);

      // Usar os dois primeiros sabores mencionados para meio a meio
      const sabor1 = saboresMencionados[0];
      const sabor2 = saboresMencionados[1];

      // Criar identificador composto
      const meioAMeioId = `${sabor1.id}+${sabor2.id}`;
      console.log(`ID de meio a meio gerado: ${meioAMeioId}`);

      return [meioAMeioId];
    }
  }

  // Verificar múltiplas pizzas mencionadas
  // Verificar se a mensagem contém "e" ou vírgulas, indicando múltiplos pedidos
  const multipleRequest = message.includes(' e ') ||
    message.includes(',') ||
    message.includes('também') ||
    message.includes('ambas') ||
    message.includes('duas') ||
    message.includes('outra');

  // Armazenar todos os IDs encontrados
  const foundIds = [];

  // Procurar por nomes de pizza na mensagem
  for (const pizza of pizzaTypes) {
    if (message.includes(pizza.name)) {
      foundIds.push(pizza.id);
    }
  }

  // Se encontrou algum ID, retornar
  if (foundIds.length > 0) {
    console.log(`Encontradas ${foundIds.length} referências de imagens: ${foundIds.join(', ')}`);
    return foundIds;
  }

  return null;
}

// Processar imagens de pizza meio a meio
async function overlayImages(baseImageUrl, overlayImageUrl) {
  // Importar o módulo canvas
  const { createCanvas, loadImage } = require('canvas');
  const axios = require('axios');

  try {
    console.log('Base image URL:', baseImageUrl.substring(0, 30) + '...');
    console.log('Overlay image URL:', overlayImageUrl.substring(0, 30) + '...');

    // Função para baixar imagem de uma URL
    async function downloadImage(url) {
      const response = await axios({
        method: 'get',
        url,
        responseType: 'arraybuffer'
      });
      return Buffer.from(response.data);
    }

    // Baixar as duas imagens
    const baseBuffer = await downloadImage(baseImageUrl);
    const overlayBuffer = await downloadImage(overlayImageUrl);

    // Carregar as imagens baixadas
    const baseImage = await loadImage(baseBuffer);
    const overlayImage = await loadImage(overlayBuffer);

    console.log('Base image size:', baseImage.width, 'x', baseImage.height);
    console.log('Overlay image size:', overlayImage.width, 'x', overlayImage.height);

    // Criar canvas do tamanho da imagem base
    const canvas = createCanvas(baseImage.width, baseImage.height);
    const ctx = canvas.getContext('2d');

    // Desenhar a imagem de fundo primeiro (sabor 2 - direita)
    ctx.drawImage(baseImage, 0, 0, baseImage.width, baseImage.height);

    // Sobrepor a primeira imagem por cima (sabor 1 - esquerda)
    ctx.drawImage(
      overlayImage,
      0, 0, overlayImage.width, overlayImage.height,  // Toda a imagem de overlay
      0, 0, baseImage.width, baseImage.height  // Cobrir toda a base
    );

    // Converter canvas para base64 com MIME type jpeg
    const mergedBase64 = canvas.toDataURL('image/jpeg');

    return mergedBase64;
  } catch (error) {
    console.error('Erro ao sobrepor imagens:', error);

    // Retornar apenas a URL da imagem base como fallback
    // Isso permite que o processo continue mesmo se a sobreposição falhar
    return baseImageUrl;
  }
}

// Gerar texto de confirmação do pedido
function gerarTextoConfirmacaoPedido(pedidoData, conversa) {
  try {
    if (!pedidoData || !pedidoData.items || !pedidoData.endereco || !pedidoData.pagamento) {
      return "Pedido confirmado! Obrigado pela preferência.";
    }

    // Determinar o endereço mais completo disponível
    let endereco = pedidoData.endereco;
    if (conversa && conversa.addressData && conversa.addressData.formattedAddress) {
      endereco = conversa.addressData.formattedAddress;
    }

    let texto = "🎉 *PEDIDO CONFIRMADO* 🎉\n\n";
    texto += "*Itens:*\n";

    let total = 0;
    pedidoData.items.forEach(item => {
      const subtotal = parseFloat(item.preco) * (item.quantidade || 1);
      texto += `- ${item.quantidade || 1}x *${item.nome}*: R$${parseFloat(item.preco).toFixed(2)} = R$${subtotal.toFixed(2)}\n`;
      total += subtotal;
    });

    texto += `\n*Valor Total:* R$${total.toFixed(2)}\n`;
    texto += `*Endereço de Entrega:* ${endereco}\n`;
    texto += `*Forma de Pagamento:* ${pedidoData.pagamento}\n\n`;
    texto += "Seu pedido será entregue em aproximadamente 50 minutos. Obrigado pela preferência! 🍕";

    return texto;
  } catch (error) {
    console.error('Erro ao gerar texto de confirmação:', error);
    return "Pedido confirmado! Obrigado pela preferência.";
  }
}

// Checagem de avanço de estado no fluxo de conversa
function checkIfShouldAdvanceState(botResponse, userMessage, currentState, conversa) {
  try {
    // Lógica básica para determinar se deve avançar de estado
    const userMsg = userMessage ? userMessage.toLowerCase() : '';

    // Logs para debugging
    console.log(`Verificando avanço de estado. Estado atual: ${currentState}`);
    console.log(`Mensagem do usuário: "${userMsg.substring(0, 50)}..."`);

    // Retornar valores concretos em vez de undefined
    switch (currentState) {
      case 0: // Escolha de sabor
        // Verificar sabores específicos ou pedido direto
        const hasPizzaRequest = userMsg.includes('pizza') ||
          userMsg.includes('tropicale') ||
          userMsg.includes('amazonas') ||
          userMsg.includes('napolitana') ||
          userMsg.includes('pedido') ||
          userMsg.includes('quero') ||
          userMsg.includes('manda');

        console.log(`Estado 0 - Deve avançar? ${hasPizzaRequest} (pedido de pizza detectado)`);
        return hasPizzaRequest;

      case 1: // Inteira ou meio a meio
        // Verificar se a mensagem atual ou a mensagem inicial já contém as informações necessárias
        const shouldAdvance1 = userMsg.includes('inteira') ||
          userMsg.includes('meio') ||
          userMsg.includes('metade') ||
          // Adicionar checagem para ver se já temos sabor e tamanho informados
          (botResponse.toLowerCase().includes('pizza') &&
            (botResponse.toLowerCase().includes('grande') ||
              botResponse.toLowerCase().includes('média') ||
              botResponse.toLowerCase().includes('pequena') ||
              botResponse.toLowerCase().includes('familia')));

        // Verificar se o LLM está perguntando sobre tamanho ou tipo
        const isAskingForSize = botResponse.toLowerCase().includes('tamanho') ||
          botResponse.toLowerCase().includes('grande') ||
          botResponse.toLowerCase().includes('média') ||
          botResponse.toLowerCase().includes('pequena');

        const isAskingForType = botResponse.toLowerCase().includes('inteira') ||
          botResponse.toLowerCase().includes('meio a meio');

        // Se o LLM já está perguntando sobre tamanho ou tipo, considerar que já temos as informações básicas
        if (isAskingForSize || isAskingForType) {
          console.log('LLM já está perguntando sobre tamanho ou tipo, considerando avanço');
          return true;
        }

        console.log(`Estado 1 - Deve avançar? ${shouldAdvance1}`);
        return shouldAdvance1;

      case 2: // Mais pizza ou finalizar
        const shouldAdvance2 = userMsg.includes('finalizar') ||
          userMsg.includes('mais uma') ||
          userMsg.includes('outra pizza');
        console.log(`Estado 2 - Deve avançar? ${shouldAdvance2}`);
        return shouldAdvance2;

      case 3: // Bebidas
        const shouldAdvance3 = userMsg.includes('sim') ||
          userMsg.includes('não') ||
          userMsg.includes('nao') ||
          userMsg.includes('refrigerante') ||
          userMsg.includes('guaraná') ||
          userMsg.includes('guarana') ||
          userMsg.includes('coca') ||
          userMsg.includes('sem refrigerante') ||
          userMsg.includes('sem bebida');
        console.log(`Estado 3 - Deve avançar? ${shouldAdvance3}`);
        return shouldAdvance3;

      case 4: // Endereço - Exigir número
        // Verificar se tem CEP
        const hasCEP = /\d{5}-?\d{3}/.test(userMsg);

        // Verificar se tem número de endereço
        const hasNumber = /\d+/.test(userMsg);

        console.log(`Estado 4 - Tem CEP? ${hasCEP}, Tem número? ${hasNumber}`);

        // Se tem CEP, mas não detectou número específico, verificar o contexto
        if (hasCEP) {
          // Se tiver um número após uma vírgula, considerar como número de endereço
          const commaNumberMatch = userMsg.match(/,\s*(\d+)/);
          if (commaNumberMatch) {
            const addressNumber = commaNumberMatch[1];
            console.log(`Estado 4 - Número após vírgula detectado: ${addressNumber}`);
            return true; // Avançar estado
          }
        }

        // Verificar se é uma resposta específica para a pergunta sobre número
        if (userMsg.match(/^\s*\d+\s*$/) && currentState === 4) {
          console.log(`Estado 4 - Resposta específica com número: ${userMsg.trim()}`);
          return true; // Se é apenas um número, provavelmente é resposta ao pedido de número
        }

        if (hasNumber) {
          return true; // Só avança se tiver número
        }
        return false;

      case 5: // Pagamento
        const shouldAdvance5 = userMsg.includes('débito') ||
          userMsg.includes('debito') ||
          userMsg.includes('crédito') ||
          userMsg.includes('credito') ||
          userMsg.includes('dinheiro') ||
          userMsg.includes('pix') ||
          userMsg.includes('vr');
        console.log(`Estado 5 - Deve avançar? ${shouldAdvance5}`);
        return shouldAdvance5;

      case 6: // Confirmação
        // Se o usuário confirma o pedido
        const userConfirms = userMessage.toLowerCase().includes('sim') ||
          userMessage.toLowerCase().includes('confirmo') ||
          userMessage.toLowerCase().includes('correto') ||
          userMessage.toLowerCase().includes('ok') ||
          userMessage.toLowerCase().includes('pode ser');

        // Verificar se o LLM usou a tag de confirmação final
        const hasConfirmationTag = botResponse.includes('[CONFIRMATION_FORMAT]');

        // Verificar se temos dados de pedido válidos na conversa
        const hasPedidoData = conversa && conversa.pedidoData &&
          conversa.pedidoData.items &&
          conversa.pedidoData.endereco &&
          conversa.pedidoData.pagamento;

        console.log(`Estado 6 - Usuário confirmou? ${userConfirms}, Tem tag de confirmação? ${hasConfirmationTag}, Tem dados de pedido? ${hasPedidoData}`);

        // Avançar estado apenas se todas as condições forem atendidas
        const shouldAdvance6 = userConfirms && hasConfirmationTag && hasPedidoData;
        console.log(`Estado 6 - Deve avançar? ${shouldAdvance6}`);
        return shouldAdvance6;

      case 7: // Pedido já confirmado - não avançar mais
        console.log('Estado 7 - Pedido já confirmado, não avançar mais');
        return false;

      default:
        console.log(`Estado desconhecido: ${currentState}, não avançar`);
        return false;
    }
  } catch (error) {
    console.error('Erro na função checkIfShouldAdvanceState:', error);
    return false; // Em caso de erro, não avançar o estado
  }
}

// Processar resposta com tags formatadas
async function processTaggedResponse(botResponse, userMessage, conversa, botConfig) {
  const processStartTime = Date.now();
  console.log(`[${new Date().toISOString()}] Iniciando processamento de resposta formatada para conversa ${conversa?._id}`);

  const responseObj = {
    success: true,
    state: conversa?.state
  };

  // Preservar o texto original com as tags para o WhatsApp Bot processar
  responseObj.text = botResponse;

  // Log das tags encontradas (apenas para depuração)
  const textFormatCount = (botResponse.match(/\[TEXT_FORMAT\]/g) || []).length;
  const endTagCount = (botResponse.match(/\[\/END\]/g) || []).length;
  console.log(`Número de tags [TEXT_FORMAT]: ${textFormatCount}`);
  console.log(`Número de tags [/END]: ${endTagCount}`);

  const voiceMatch = botResponse.match(/\[VOICE_FORMAT\]([\s\S]*?)\[\/END\]/);
  const jsonMatch = botResponse.match(/\[JSON_FORMAT\]([\s\S]*?)\[\/END\]/);

  // Verificar estados de resumo e confirmação - desabilitar geração de áudio
  if ((conversa.state === 6 || conversa.state === 7) && voiceMatch) {
    console.log("Ignorando solicitação de áudio nos estados de resumo/confirmação conforme regras");
    // Não processar áudio em estados de confirmação/resumo
    const voiceText = voiceMatch[1].trim();

    // Verificar se há texto no formato [TEXT_FORMAT]
    const textMatch = botResponse.match(/\[TEXT_FORMAT\]([\s\S]*?)\[\/END\]/);
    if (!textMatch) {
      // Se não tiver texto, usar o texto do áudio como texto normal
      const newResponse = `[TEXT_FORMAT]${voiceText}[/END]`;
      responseObj.text = newResponse;
    }
  } else if (voiceMatch) {
    try {
      const voiceText = voiceMatch[1].trim();
      console.log('Processando solicitação de áudio com texto:', voiceText.substring(0, 50) + '...');

      const audioUrl = await generateAudio(voiceText);
      console.log('URL de áudio gerada:', audioUrl);

      if (audioUrl) {
        // Apenas armazenar a URL na resposta, sem tentar baixar o arquivo
        responseObj.audio = audioUrl;
        console.log('URL de áudio adicionada à resposta:', audioUrl);
      } else {
        console.error('URL de áudio não gerada');
      }
    } catch (audioError) {
      console.error('Erro ao gerar áudio:', audioError);
    }
  }

  // Extrair TODAS as tags de imagem usando regex global
  const imageRegex = /\[IMAGE_FORMAT\]([\s\S]*?)\[\/END\]/g;
  const imageMatches = [];
  let match;

  while ((match = imageRegex.exec(botResponse)) !== null) {
    if (match[1] && match[1].trim()) {
      imageMatches.push(match[1].trim());
    }
  }

  console.log(`Encontradas ${imageMatches.length} tags de imagem para processar`);

  // Processar pedido de imagem - primeira imagem
  if (imageMatches.length > 0) {
    try {
      const imageId = imageMatches[0].trim();
      console.log(`Processando primeira imagem com ID: ${imageId}`);

      // Determinar qual imagem enviar
      let imageUrl = null;
      let imageCaption = null;

      // Verificar se é pedido de cardápio
      if (imageId === 'cardapio' || imageId === 'menu') {
        if (botConfig && botConfig.menuImage) {
          imageUrl = botConfig.menuImage;
          imageCaption = botConfig.menuImageCaption || 'Cardápio';
        }
      }
      // Verificar se é pedido de pizza meio a meio
      else if (imageId.includes('+')) {
        console.log('Detectada solicitação de pizza meio a meio');
        const sabores = imageId.split('+');

        if (sabores.length === 2) {
          const [sabor1Id, sabor2Id] = sabores;

          // Buscar imagens de cada sabor
          const sabor1 = await CardapioItem.findOne({
            identificador: sabor1Id,
            disponivel: true
          });

          const sabor2 = await CardapioItem.findOne({
            identificador: sabor2Id,
            disponivel: true
          });

          if (sabor1 && sabor2) {
            // As duas imagens específicas para a sobreposição
            const leftImage = sabor1.imagemEsquerda;  // URL do sabor 1 (vai por cima)
            const rightImage = sabor2.imagemDireita;  // URL do sabor 2 (vai por baixo)

            if (rightImage && leftImage) {
              try {
                // IMPORTANTE: Ordem invertida! Primeiro a direita (base), depois a esquerda (sobreposição)
                console.log('Sobrepondo imagens para pizza meio a meio');
                console.log('Sabor 1 (esquerda):', sabor1.nome);
                console.log('Sabor 2 (direita):', sabor2.nome);

                // ⚠️ INVERTA A ORDEM AQUI: primeiro rightImage (base), depois leftImage (por cima)
                imageUrl = await overlayImages(rightImage, leftImage);
                imageCaption = `Pizza meio ${sabor1.nome.replaceAll('Pizza ', '')} e meio ${sabor2.nome.replaceAll('Pizza ', '')}`;
                console.log('Sobreposição de imagens concluída com sucesso');
              } catch (mergeError) {
                console.error('Erro ao sobrepor imagens:', mergeError);
                // Fallback para qualquer uma das imagens em caso de erro
                imageUrl = leftImage || rightImage;
                imageCaption = `Pizza meio ${sabor1.nome.replaceAll('Pizza ', '')} e meio ${sabor2.nome.replaceAll('Pizza ', '')} (visualização parcial)`;
              }
            } else if (sabor1.imagemGeral && sabor2.imagemGeral) {
              // Se não tiver as imagens específicas de cada lado, usar imagem geral de um dos sabores
              imageUrl = sabor1.imagemGeral;
              imageCaption = `Pizza meio ${sabor1.nome.replaceAll('Pizza ', '')} e meio ${sabor2.nome.replaceAll('Pizza ', '')} (visualização aproximada)`;
            } else {
              // Se não tiver imagens específicas, usar qualquer imagem disponível
              imageUrl = sabor1.imagemGeral || sabor1.imagemEsquerda || sabor2.imagemGeral || sabor2.imagemDireita;
              imageCaption = `Pizza meio ${sabor1.nome.replaceAll('Pizza ', '')} e meio ${sabor2.nome}`;
            }
          }
        }
      }
      // Buscar imagem de um único sabor/item
      else {
        // Buscar por identificador exato primeiro
        let item = await CardapioItem.findOne({
          identificador: imageId,
          disponivel: true
        });

        // Se não encontrar, tentar buscar pelo nome
        if (!item) {
          // Extrair o nome da pizza do identificador (ex: pizza-salgada_pizza-amazonas -> amazonas)
          const nomePizza = imageId.split('_pizza-')[1];

          if (nomePizza) {
            item = await CardapioItem.findOne({
              nome: { $regex: new RegExp(nomePizza, 'i') },
              disponivel: true
            });
          }
        }

        // Se ainda não encontrar, fazer uma busca mais ampla
        if (!item) {
          item = await CardapioItem.findOne({
            $or: [
              { identificador: { $regex: new RegExp(imageId, 'i') } },
              { nome: { $regex: new RegExp(imageId, 'i') } }
            ],
            disponivel: true
          });
        }

        if (item) {
          // Usar imagem geral para um sabor único
          imageUrl = item.imagemGeral;
          imageCaption = `*${item.nome}*: ${item.descricao || ''}`;
        }
      }

      if (imageUrl) {
        responseObj.image = imageUrl;
        if (imageCaption) {
          responseObj.imageCaption = imageCaption;
        }

        // Adicionar propriedade para múltiplas imagens
        responseObj.allImages = [{
          id: imageId,
          url: imageUrl,
          caption: imageCaption
        }];

        // Verificar se é o cardápio ou uma pizza específica
        const isMenuImage = imageId === 'cardapio' || imageId === 'menu' ||
          (imageCaption && (imageCaption.toLowerCase().includes('cardápio') ||
            imageCaption.toLowerCase().includes('cardapio')));

        // Se há imagem mas não há texto explícito, verificar o estado atual e adicionar pergunta adequada
        const textMatch = botResponse.match(/\[TEXT_FORMAT\]([\s\S]*?)\[\/END\]/);
        if (!textMatch || !responseObj.text || responseObj.text.trim() === '') {
          if (isMenuImage) {
            // Se for o cardápio, perguntar qual sabor deseja
            responseObj.text = "Aqui está nosso cardápio. Qual sabor de pizza você gostaria de pedir?";
          } else {
            const isPizzaDoce = imageId.includes('pizza-doce') ||
              (imageCaption && imageCaption.toLowerCase().includes('doce'));
            // Para pizzas individuais, usar a lógica baseada no estado
            switch (conversa.state) {
              case 0:
                responseObj.text = `Aqui está a imagem da ${imageCaption}. Gostaria de pedir esta pizza? Ou prefere ver outras opções?`;
                break;
              case 1:
                if (isPizzaDoce) {
                  responseObj.text = `Esta é a nossa ${imageCaption}. Gostaria de pedir agora?`;
                } else {
                  responseObj.text = `Esta é a nossa ${imageCaption}. Você gostaria dela inteira ou meio a meio com outro sabor?`;
                }
                break;
              case 2:
                responseObj.text = `Aqui está a ${imageCaption}. Gostaria de pedir mais alguma pizza ou podemos prosseguir com o pedido?`;
                break;
              case 3:
                responseObj.text = `Esta é a deliciosa ${imageCaption}. Gostaria de adicionar alguma bebida ao seu pedido?`;
                break;
              default:
                responseObj.text = `Esta é a nossa ${imageCaption}. O que você gostaria de fazer a seguir?`;
            }
          }
        } else if (responseObj.text && conversa.state >= 0 && conversa.state <= 3) {
          // Se já tem texto mas não tem pergunta no final, adicionar pergunta
          const hasQuestion = /\?$/.test(responseObj.text.trim());

          if (!hasQuestion) {
            // Determinar qual pergunta adicionar com base no tipo de imagem e estado
            let questionToAdd = '';

            if (isMenuImage) {
              questionToAdd = ' Qual sabor você gostaria de experimentar?';
            } else {
              const isPizzaDoce = imageId.includes('pizza-doce') ||
                (imageCaption && imageCaption.toLowerCase().includes('doce'));
              switch (conversa.state) {
                case 0:
                  questionToAdd = ' Gostaria de pedir agora?';
                  break;
                case 1:
                  if (isPizzaDoce) {
                    questionToAdd = ' Gostaria de pedir agora?';
                  } else {
                    questionToAdd = ' Você prefere ela inteira ou meio a meio com outro sabor?';
                  }
                  break;
                case 2:
                  questionToAdd = ' Deseja mais alguma pizza ou podemos prosseguir?';
                  break;
                case 3:
                  questionToAdd = ' Gostaria de adicionar alguma bebida ao pedido?';
                  break;
              }
            }

            // Adicionar a pergunta ao texto existente
            responseObj.text = responseObj.text.trim() + questionToAdd;
          }
        }
      } else {
        // Item não encontrado, enviar mensagem de texto informando
        if (!responseObj.text) {
          responseObj.text = "Desculpe, não encontrei imagem para este item no nosso cardápio.";
        }
      }
    } catch (imageError) {
      console.error('Erro ao processar imagem:', imageError);
      if (!responseObj.text) {
        responseObj.text = "Desculpe, não consegui processar a imagem solicitada.";
      }
    }

    // PROCESSAR IMAGENS ADICIONAIS (a partir da segunda)
    if (imageMatches.length > 1) {
      console.log(`Processando ${imageMatches.length - 1} imagens adicionais`);

      // Se ainda não inicializou o array de imagens
      if (!responseObj.allImages) {
        responseObj.allImages = [];
      }

      // Processar cada imagem adicional, a partir da segunda
      for (let i = 1; i < imageMatches.length; i++) {
        const additionalImageId = imageMatches[i];
        try {
          console.log(`Processando imagem adicional ${i}/${imageMatches.length - 1}: ${additionalImageId}`);

          // Buscar diretamente no banco de dados sem usar rota HTTP
          let item = await CardapioItem.findOne({
            identificador: additionalImageId,
            disponivel: true
          });

          // Se não encontrou, tentar pelo nome da pizza
          if (!item && additionalImageId.includes('pizza-')) {
            const pizzaName = additionalImageId.split('_pizza-')[1] || additionalImageId.split('-pizza-')[1];
            if (pizzaName) {
              item = await CardapioItem.findOne({
                nome: { $regex: new RegExp(pizzaName, 'i') },
                disponivel: true
              });
            }
          }

          // Se ainda não encontrou, busca mais ampla
          if (!item) {
            item = await CardapioItem.findOne({
              $or: [
                { identificador: { $regex: new RegExp(additionalImageId, 'i') } },
                { nome: { $regex: new RegExp(additionalImageId, 'i') } }
              ],
              disponivel: true
            });
          }

          if (item && item.imagemGeral) {
            const imageUrl = item.imagemGeral;
            const caption = `*${item.nome}*: ${item.descricao || ''}`;

            // Adicionar à lista de imagens
            responseObj.allImages.push({
              id: additionalImageId,
              url: imageUrl,
              caption: caption
            });

            console.log(`Imagem adicional processada: ${additionalImageId}`);
          } else {
            console.error(`Imagem não encontrada para ID: ${additionalImageId}`);
          }
        } catch (error) {
          console.error(`Erro ao processar imagem adicional ${additionalImageId}:`, error);
        }
      }
    }
  }

  // Processar resposta JSON (para confirmação de pedido)
  if (jsonMatch) {
    try {
      let jsonData;

      // Parsear o JSON da resposta
      try {
        jsonData = JSON.parse(jsonMatch[1]);
        console.log('JSON de pedido detectado:', JSON.stringify(jsonData));
      } catch (parseError) {
        console.error('Erro ao parsear JSON:', parseError);
        jsonData = { pedido: null };
      }

      // Verificar estrutura do pedido
      let pedidoData = null;

      // Compatibilidade com diferentes estruturas
      if (jsonData.pedido) {
        pedidoData = jsonData.pedido;
      } else if (jsonData.items && jsonData.endereco && jsonData.pagamento) {
        pedidoData = jsonData;
      }

      // Se temos dados de pedido válidos
      if (pedidoData && Array.isArray(pedidoData.items) &&
        pedidoData.endereco && pedidoData.pagamento) {

        // ADICIONE AQUI: Armazenar dados temporariamente pelo telefone
        if (conversa && conversa.telefone) {
          // Armazenar o pedido mais recente
          tempPedidoData.set(conversa.telefone, pedidoData);
          console.log(`Dados de pedido armazenados temporariamente para ${conversa.telefone}`);
        }

        // Verificar se o endereço tem número
        if (!pedidoData.endereco.match(/\d+/)) {
          console.log("Endereço sem número na confirmação");
          // Não permitir confirmação
          if (conversa && typeof conversa === 'object') {
            // Atualizar o estado apenas se possível
            conversa.state = 4; // Voltar para estado de endereço

            // Salvar apenas se for um documento Mongoose
            if (typeof conversa.save === 'function') {
              try {
                await conversa.save();
              } catch (saveError) {
                console.error("Erro ao salvar conversa (verificação de endereço):", saveError);
              }
            }
          }

          return {
            success: true,
            state: 4,
            text: "Preciso do número do endereço antes de confirmar. Por favor, informe o número completo."
          };
        }

        try {
          // Armazenar dados do pedido na conversa para referência
          if (conversa && typeof conversa === 'object') {
            conversa.pedidoData = pedidoData;

            // Colocar a conversa no estado de confirmação
            if (conversa.state < 6) {
              conversa.state = 6; // Estado de confirmação de pedido
            }

            // Salvar a conversa com os dados do pedido, mas sem criar no banco ainda
            if (typeof conversa.save === 'function') {
              try {
                await conversa.save();
                console.log(`Dados do pedido armazenados na conversa ${conversa._id || 'desconhecida'}`);
              } catch (saveError) {
                console.error("Erro ao salvar conversa (armazenamento de dados):", saveError);
              }
            }
          }

          // Armazenar temporariamente para referência futura
          if (conversa && conversa.telefone) {
            tempPedidoData.set(conversa.telefone, pedidoData);
            console.log(`Dados de pedido armazenados temporariamente para ${conversa.telefone}`);
          }

          // Gerar texto de resumo para confirmação
          let textoResumo = "";

          // Calcular valor total
          let valorTotal = 0;
          pedidoData.items.forEach(item => {
            const quantidade = item.quantidade || 1;
            const preco = parseFloat(item.preco);
            valorTotal += preco * quantidade;
          });

          textoResumo = `
        [TEXT_FORMAT]Vamos conferir seu pedido:
        
        *Pizza ${pedidoData.items[0].nome}* - R$ ${parseFloat(pedidoData.items[0].preco).toFixed(2)}
        
        *Endereço de entrega:* ${pedidoData.endereco}
        *Forma de pagamento:* ${pedidoData.pagamento}
        
        *Total:* R$ ${valorTotal.toFixed(2)}
        
        Está tudo correto? Responda SIM para confirmar ou me diga o que gostaria de modificar.[/END]
          `.trim();

          // Atualizar resposta com o texto de resumo
          responseObj.text = textoResumo;

        } catch (pedidoError) {
          console.error("Erro no processamento do pedido:", pedidoError);

          // Informar erro ao usuário
          responseObj.text = "Houve um problema ao registrar seu pedido. Por favor, tente novamente ou entre em contato por telefone.";
        }
      }
    } catch (jsonError) {
      console.error('Erro ao processar resposta JSON:', jsonError);
    }
  }

  // Verificar se existe a tag CONFIRMATION_FORMAT
  const confirmationMatch = botResponse.match(/\[CONFIRMATION_FORMAT\]([\s\S]*?)\[\/END\]/);
  if (confirmationMatch) {
    console.log('Tag CONFIRMATION_FORMAT detectada - processando confirmação final do pedido');

    if (conversa) {
      // IMPORTANTE: Verificar se o pedido já foi salvo para esta conversa
      if (conversa.pedidoId) {
        console.log(`Pedido já registrado para esta conversa: ${conversa.pedidoId}. Evitando duplicação.`);

        // Não criar novo pedido, apenas atualizar a resposta
        responseObj.text = confirmationMatch[1];

        // Se tiver imagem de confirmação configurada
        if (botConfig && botConfig.confirmationImage) {
          responseObj.image = botConfig.confirmationImage;
          responseObj.imageCaption = botConfig.confirmationImageCaption || 'Pedido Confirmado';
        }

        return responseObj; // Sair da função para evitar processamento adicional
      }

      // Usar os dados já armazenados na conversa
      const savedPedidoData = conversa.pedidoData;

      if (savedPedidoData) {
        console.log(`Processando confirmação final com dados da conversa para ${conversa.telefone}`);

        // GARANTIR QUE O ENDEREÇO TENHA NÚMERO
        const endereco = savedPedidoData.endereco;
        if (!endereco || !endereco.match(/\d+/)) {
          console.error('ERRO: Tentativa de confirmação com endereço sem número');

          // Se temos addressData com endereço formatado, usar ele
          if (conversa.addressData && conversa.addressData.formattedAddress &&
            conversa.addressData.formattedAddress.match(/\d+/)) {

            console.log('Recuperando endereço com número dos dados de addressData');
            savedPedidoData.endereco = conversa.addressData.formattedAddress;
          } else {
            // Não permitir confirmação sem número no endereço
            responseObj.text = "Desculpe, precisamos de um endereço completo com número para confirmar seu pedido. Por favor, informe o número do seu endereço.";

            // Tentar reverter para o estado de coleta de endereço
            conversa.state = 4;
            await conversa.save();

            return responseObj; // Sair da função para evitar processamento adicional
          }
        }

        try {
          // Calcular valor total
          let valorTotal = 0;
          savedPedidoData.items.forEach(item => {
            const quantidade = item.quantidade || 1;
            const preco = parseFloat(item.preco);
            if (isNaN(preco)) {
              throw new Error(`Preço inválido para o item ${item.nome}`);
            }
            valorTotal += preco * quantidade;
          });

          // Log detalhado antes da criação do pedido
          console.log('=== DADOS PARA CRIAÇÃO DO PEDIDO ===');
          console.log(`Telefone: ${conversa.telefone}`);
          console.log(`Itens: ${JSON.stringify(savedPedidoData.items)}`);
          console.log(`Endereço: ${savedPedidoData.endereco}`);
          console.log(`Pagamento: ${savedPedidoData.pagamento}`);
          console.log(`Valor Total: ${valorTotal}`);
          console.log('======================================');

          // Criar novo pedido
          const novoPedido = new Pedido({
            telefone: conversa.telefone,
            itens: savedPedidoData.items.map(item => ({
              nome: item.nome,
              quantidade: item.quantidade || 1,
              preco: parseFloat(item.preco)
            })),
            valorTotal: valorTotal,
            endereco: savedPedidoData.endereco,
            formaPagamento: savedPedidoData.pagamento,
            status: 'Confirmado',
            data: new Date().toISOString()
          });

          const pedidoSalvo = await novoPedido.save();
          console.log(`[CONFIRMAÇÃO FINAL] Pedido salvo com sucesso: ${pedidoSalvo._id}`);

          // Atualizar conversa
          conversa.pedidoId = pedidoSalvo._id;
          conversa.state = 7; // Estado de pedido confirmado
          await conversa.save();

          // Adicionar texto de confirmação à resposta
          responseObj.text = confirmationMatch[1];

          // Se tiver imagem de confirmação configurada
          if (botConfig && botConfig.confirmationImage) {
            responseObj.image = botConfig.confirmationImage;
            responseObj.imageCaption = botConfig.confirmationImageCaption || 'Pedido Confirmado';
          }
        } catch (error) {
          console.error('Erro ao processar confirmação final do pedido:', error);
          responseObj.text = "Houve um problema ao confirmar seu pedido. Por favor, tente novamente ou entre em contato por telefone.";
        }
      } else {
        console.error('Dados do pedido não encontrados na conversa');
        responseObj.text = "Não consegui encontrar os detalhes do seu pedido para confirmar. Por favor, tente fazer o pedido novamente.";
      }
    } else {
      console.error('Conversa não disponível para processar confirmação');
    }
  }

  // Se após todo o processamento não temos nenhum conteúdo para enviar
  if (!responseObj.text && !responseObj.image && !responseObj.audio) {
    // Verificar se a resposta original não tinha tags
    if (!botResponse.includes('[TEXT_FORMAT]') &&
      !botResponse.includes('[VOICE_FORMAT]') &&
      !botResponse.includes('[IMAGE_FORMAT]') &&
      !botResponse.includes('[JSON_FORMAT]')) {

      console.log('Resposta sem tags de formatação, usando texto original');
      responseObj.text = botResponse;
    } else {
      responseObj.text = "Desculpe, ocorreu um erro ao processar sua mensagem. Poderia tentar novamente?";
    }
  }

  const processEndTime = Date.now();
  console.log(`[${new Date().toISOString()}] Processamento de resposta formatada concluído em ${processEndTime - processStartTime}ms`);

  return responseObj;
}

// Extrai dados de pedido de uma resposta formatada
async function extractPedidoData(text, conversa) {
  // Buscar tag JSON_FORMAT
  const jsonMatch = text.match(/\[JSON_FORMAT\]([\s\S]*?)\[\/END\]/);
  if (!jsonMatch) return null;

  try {
    // Parsear JSON
    const jsonData = JSON.parse(jsonMatch[1]);
    console.log('JSON de pedido detectado na API:', JSON.stringify(jsonData).substring(0, 100) + '...');

    // Verificar estrutura
    let pedidoData = null;
    if (jsonData.pedido) {
      pedidoData = jsonData.pedido;
    } else if (jsonData.items && jsonData.endereco && jsonData.pagamento) {
      pedidoData = jsonData;
    }

    // Se temos dados válidos
    if (pedidoData && Array.isArray(pedidoData.items) &&
      pedidoData.endereco && pedidoData.pagamento) {

      // Verificar endereço
      if (!pedidoData.endereco.match(/\d+/)) {
        console.log("Endereço sem número detectado, não atualizando dados");
        return null;
      }

      console.log(`Dados de pedido válidos extraídos: ${pedidoData.items.length} itens`);
      return pedidoData;
    }

    return null;
  } catch (error) {
    console.error('Erro ao extrair dados do pedido:', error);
    return null;
  }
}

// Gerar áudio a partir de texto
async function generateAudio(text) {
  try {
    console.log("Gerando áudio para:", text.substring(0, 50) + "...");

    // Verificar se o diretório de mídia existe
    const mediaDir = path.join(__dirname, 'public', 'media');
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    // Limpar o texto para melhor qualidade de áudio
    const cleanedText = text
      .replace(/<\/?[^>]+(>|$)/g, "") // Remove tags HTML
      .replace(/\*\*/g, "") // Remove negrito markdown
      .replace(/\*/g, ""); // Remove itálico markdown

    // Gerar áudio com OpenAI
    const speech = await openai.audio.speech.create({
      model: "tts-1",
      voice: "ash",
      input: `\u200B ${cleanedText}`,
      response_format: "mp3"
    });

    // Processar resultado
    const arrayBuffer = await speech.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error("API retornou um buffer vazio");
    }

    // Salvar arquivo
    const filename = `speech-${Date.now()}.mp3`;
    const audioPath = path.join(mediaDir, filename);
    fs.writeFileSync(audioPath, buffer);

    // Verificar se o arquivo foi criado corretamente
    if (fs.existsSync(audioPath)) {
      const stats = fs.statSync(audioPath);
      console.log(`Arquivo de áudio criado: ${audioPath}, tamanho: ${stats.size} bytes`);

      if (stats.size > 0) {
        // URL do áudio
        return `/api/media/${filename}`;
      }
    }

    return null;
  } catch (error) {
    console.error('Erro detalhado ao gerar áudio:', error);
    return null;
  }
}

// ======== FUNÇÕES ESPECÍFICAS DO WHATSAPP BOT ==========

// Processar mensagem de texto para o WhatsApp
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

    // Buscar ou criar conversa para o usuário
    let conversa = await getOrCreateConversation(userPhone, text);
    if (!conversa) {
      console.error('Não foi possível criar ou obter uma conversa válida');
      await client.sendMessage(userPhone, "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.");
      return;
    }

    // Verificar se há um pedido de reinicialização
    if (text.toLowerCase() === 'reiniciar' ||
      text.toLowerCase() === 'começar de novo' ||
      text.toLowerCase() === 'novo pedido') {
      await handleResetRequest(userPhone);
      return;
    }

    // Processar a mensagem com a API interna
    const apiResponse = await processMessageInternally(userPhone, text, false, 'text', conversa);

    // Verificar se temos uma resposta válida
    if (!apiResponse || !apiResponse.success) {
      await client.sendMessage(userPhone, "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.");
      return;
    }

    // Enviar texto (blocos [TEXT_FORMAT])
    if (apiResponse.text) {
      // Extrair e enviar blocos de texto
      const textBlocks = apiResponse.text.match(/\[TEXT_FORMAT\]([\s\S]*?)\[\/END\]/g) || [];
      for (const block of textBlocks) {
        const cleanText = block.replace(/\[TEXT_FORMAT\]|\[\/END\]/g, '').trim();
        if (cleanText) {
          await client.sendMessage(userPhone, cleanText);
        }
      }
    }

    // Processar áudio
    if (apiResponse.audio) {
      try {
        const audioPath = await downloadMedia(apiResponse.audio, 'audio');
        if (audioPath) {
          const media = MessageMedia.fromFilePath(audioPath);
          await client.sendMessage(userPhone, media, {
            sendAudioAsVoice: true,
            mimetype: 'audio/mp3'
          });

          // Limpar arquivo temporário
          fs.unlinkSync(audioPath);
        }
      } catch (audioError) {
        console.error('Erro ao processar áudio:', audioError);
      }
    }

    // Processar imagem principal
    if (apiResponse.image && !sentImages.has(apiResponse.image)) {
      try {
        if (apiResponse.image.startsWith('data:image')) {
          const matches = apiResponse.image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            const mediaType = matches[1];
            const mediaData = matches[2];
            const caption = apiResponse.imageCaption || '';

            const media = new MessageMedia(mediaType, mediaData);
            await client.sendMessage(userPhone, media, { caption });
            sentImages.add(apiResponse.image);
          }
        } else {
          const imagePath = await downloadMedia(apiResponse.image, 'image');
          if (imagePath) {
            const media = MessageMedia.fromFilePath(imagePath);
            await client.sendMessage(userPhone, media, { caption: apiResponse.imageCaption || '' });
            sentImages.add(apiResponse.image);
            fs.unlinkSync(imagePath);
          }
        }
      } catch (imageError) {
        console.error('Erro ao enviar imagem principal:', imageError);
      }
    }

    // Processar imagens adicionais do array allImages
    if (apiResponse.allImages && apiResponse.allImages.length > 0) {
      for (const imgData of apiResponse.allImages) {
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
                sentImages.add(imgData.url);
              }
            } else {
              const imagePath = await downloadMedia(imgData.url, 'image');
              if (imagePath) {
                const media = MessageMedia.fromFilePath(imagePath);
                await client.sendMessage(userPhone, media, { caption: imgData.caption || '' });
                sentImages.add(imgData.url);
                fs.unlinkSync(imagePath);
              }
            }
          } catch (error) {
            console.error(`Erro ao processar imagem adicional ${imgData.id}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error('Erro ao processar mensagem de texto:', error);
    await client.sendMessage(userPhone, 'Desculpe, ocorreu um erro ao processar sua mensagem.');
  } finally {
    // Limpar o conjunto de imagens enviadas
    sentImages.clear();
  }
}

// Buscar ou criar conversa para um usuário
async function getOrCreateConversation(userPhone, message) {
  try {
    // Verificar se há pedido de reiniciar
    const isResetRequest = message.toLowerCase() === 'reiniciar' ||
      message.toLowerCase() === 'começar de novo' ||
      message.toLowerCase() === 'novo pedido';

    // Buscar a conversa mais recente para este telefone
    let conversa = await Conversa.findOne({ telefone: userPhone }).sort({ inicio: -1 });
    let novaConversaCriada = false;

    // LÓGICA DE CRIAÇÃO DE NOVA CONVERSA
    if (isResetRequest) {
      // Criar nova conversa em caso de reinício explícito
      conversa = new Conversa({
        telefone: userPhone,
        inicio: new Date().toISOString(),
        duracao: 0,
        state: 0,
        mensagens: []
      });
      await conversa.save();
      novaConversaCriada = true;
      console.log('Nova conversa criada por pedido de reinício:', conversa._id);
    }
    else if (conversa) {
      // Verificar se o último pedido foi finalizado ou está muito antigo
      if (conversa.state === 7 || (new Date() - new Date(conversa.inicio)) > 3 * 60 * 60 * 1000) { // 3 horas
        // Criar nova conversa para novo pedido
        conversa = new Conversa({
          telefone: userPhone,
          inicio: new Date().toISOString(),
          duracao: 0,
          state: 0,
          mensagens: []
        });
        await conversa.save();
        novaConversaCriada = true;
        console.log('Nova conversa criada (última finalizada ou antiga):', conversa._id);
      }
    }
    else {
      // Se não existir nenhuma conversa, criar a primeira
      conversa = new Conversa({
        telefone: userPhone,
        inicio: new Date().toISOString(),
        duracao: 0,
        state: 0,
        mensagens: []
      });
      await conversa.save();
      novaConversaCriada = true;
      console.log('Primeira conversa criada:', conversa._id);
    }

    return conversa;
  } catch (error) {
    console.error('Erro ao buscar/criar conversa:', error);
    return null;
  }
}

// Tratar pedido de áudio 
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
      // Buscar a conversa atual
      const conversa = await Conversa.findOne({ telefone: userPhone }).sort({ inicio: -1 });
      if (!conversa || !conversa.pedidoData) {
        await client.sendMessage(userPhone,
          "Desculpe, não encontrei dados de pedido para gerar o áudio. Por favor, faça seu pedido primeiro.");
        return true;
      }

      // Gerar texto de confirmação baseado nos dados do pedido
      const confirmationText = gerarTextoConfirmacaoPedido(conversa.pedidoData, conversa);

      // Gerar áudio
      const audioUrl = await generateAudio(confirmationText);
      if (audioUrl) {
        const audioPath = await downloadMedia(audioUrl, 'audio');
        if (audioPath) {
          const media = MessageMedia.fromFilePath(audioPath);
          await client.sendMessage(userPhone, media, {
            sendAudioAsVoice: true,
            mimetype: 'audio/mp3'
          });

          // Limpar arquivo temporário
          fs.unlinkSync(audioPath);
        }
      } else {
        await client.sendMessage(userPhone,
          "Desculpe, não consegui gerar o áudio da confirmação neste momento. " +
          "Seu pedido foi registrado e será entregue em aproximadamente 50 minutos.");
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error('Erro ao processar pedido de áudio:', error);
    return false;
  }
}

// Processar mensagem de áudio no WhatsApp
async function processAudioMessage(userPhone, media) {
  console.log(`Nova mensagem de áudio de ${userPhone}`);

  try {
    // Verificar se a API Key da OpenAI está configurada
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("API key da OpenAI não configurada");
    }

    // Salvar o áudio temporariamente
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

    // Transcrever o áudio com OpenAI
    try {
      const transcript = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-1",
        response_format: "json"
      });

      console.log(`Áudio transcrito com sucesso: ${transcript.text}`);

      // Processar a transcrição como mensagem de texto
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
    await client.sendMessage(userPhone, 'Não consegui entender o áudio. Pode tentar novamente ou enviar uma mensagem de texto?');
  }
}

// Processar reinicialização de pedido
async function handleResetRequest(userPhone) {
  try {
    // Criar nova conversa
    const conversa = new Conversa({
      telefone: userPhone,
      inicio: new Date().toISOString(),
      duracao: 0,
      state: 0,
      mensagens: []
    });

    // Salvar a nova conversa
    await conversa.save();
    console.log('Nova conversa criada por pedido de reinício:', conversa._id);

    // Buscar a mensagem de boas-vindas
    const botConfig = await BotConfig.findOne().select('welcomeMessage');
    const welcomeMessage = (botConfig && botConfig.welcomeMessage)
      ? botConfig.welcomeMessage
      : "Olá! Sou o atendente virtual da pizzaria. Como posso ajudar?";

    // Garantir que a mensagem de boas-vindas tem o formato correto
    let formattedWelcome = welcomeMessage;
    if (!formattedWelcome.includes('[TEXT_FORMAT]')) {
      formattedWelcome = `[TEXT_FORMAT]${formattedWelcome}[/END]`;
    }

    // Adicionar mensagem do usuário
    conversa.mensagens.push({
      tipo: 'user',
      conteudo: 'reiniciar',
      data: new Date().toISOString()
    });

    // Adicionar mensagem de resposta ao histórico
    conversa.mensagens.push({
      tipo: 'bot',
      conteudo: formattedWelcome,
      data: new Date().toISOString()
    });

    await conversa.save();

    // Processar a mensagem para enviar ao usuário
    const processedResponse = await processTaggedResponse(formattedWelcome, 'reiniciar', conversa, botConfig);

    // Texto principal
    const textBlocks = processedResponse.text.match(/\[TEXT_FORMAT\]([\s\S]*?)\[\/END\]/g) || [];
    for (const block of textBlocks) {
      const cleanText = block.replace(/\[TEXT_FORMAT\]|\[\/END\]/g, '').trim();
      if (cleanText) {
        await client.sendMessage(userPhone, cleanText);
      }
    }

    return true;
  } catch (error) {
    console.error('Erro ao reiniciar conversa:', error);
    await client.sendMessage(userPhone, 'Desculpe, ocorreu um erro ao reiniciar. Por favor, tente novamente.');
    return false;
  }
}

// Função interna para processar mensagens
async function processMessageInternally(userPhone, message, isAudio = false, messageType = 'text', conversa) {
  try {
    const apiRequestStartTime = Date.now();
    console.log(`[${new Date().toISOString()}] Iniciando processamento para ${userPhone}`);

    // Validação básica de entrada
    if (!userPhone) {
      throw new Error('Número de telefone é obrigatório');
    }

    if (message === undefined || message === null) {
      throw new Error('Mensagem é obrigatória');
    }

    // Verificar se há pedido de reiniciar (já tratado em função anterior)
    if (message.toLowerCase() === 'reiniciar' ||
      message.toLowerCase() === 'começar de novo' ||
      message.toLowerCase() === 'novo pedido') {
      return {
        success: true,
        text: "Seu pedido foi reiniciado. Como posso ajudar?"
      };
    }

    // Calcular duração da conversa
    const inicio = new Date(conversa.inicio);
    const agora = new Date();
    conversa.duracao = Math.round((agora - inicio) / 60000); // Em minutos

    // Verificar se a mensagem contém um CEP
    const cepValidation = await detectAndValidateCEP(message);
    if (cepValidation) {
      console.log("Dados de CEP validados:", JSON.stringify(cepValidation));

      // Armazenar o CEP validado na conversa
      conversa.addressData = {
        formattedAddress: cepValidation.formattedAddress,
        components: cepValidation.components || { cep: cepValidation.formattedAddress.split(', ').pop() }
      };

      // Salvar imediatamente para garantir persistência
      await conversa.save();
      console.log("Endereço validado e armazenado na conversa");
    }

    // Adicionar mensagem à conversa
    conversa.mensagens.push({
      tipo: 'user',
      conteudo: isAudio ? `[Áudio]: ${message}` : message,
      data: new Date().toISOString()
    });

    // Verificação forçada para estado de endereço (sem número)
    if (conversa.state === 4) {
      // Verificar se a mensagem é apenas um número
      if (message.match(/^\s*\d+\s*$/)) {
        console.log("Usuário respondeu apenas com um número no estado de endereço");

        // Verificar se temos o nome da rua armazenado
        if (conversa.addressData && conversa.addressData.components &&
          conversa.addressData.components.street) {

          let street;
          if (typeof conversa.addressData.components === 'string') {
            try {
              const components = JSON.parse(conversa.addressData.components);
              street = components.street;
            } catch (e) {
              console.error("Erro ao parsear componentes:", e);
            }
          } else {
            street = conversa.addressData.components.street;
          }

          if (street) {
            // Formatar endereço completo com o número fornecido
            const number = message.trim();

            let formattedAddress;
            if (conversa.addressData.formattedAddress) {
              formattedAddress = conversa.addressData.formattedAddress.replace(street, `${street}, ${number}`);
            } else {
              formattedAddress = `${street}, ${number}`;
            }

            conversa.addressData.formattedAddress = formattedAddress;

            // Se temos pedidoData, atualizar o endereço lá também
            if (conversa.pedidoData) {
              conversa.pedidoData.endereco = formattedAddress;
            }

            // Avançar para o próximo estado
            conversa.state = 5;

            await conversa.save();

            // Responder diretamente, sem chamar a API
            const confirmationMessage = `Perfeito! Endereço registrado: ${formattedAddress}. Qual será a forma de pagamento? Temos as opções: Dinheiro, Cartão de crédito, Cartão de débito, PIX ou VR.`;

            // Adicionar resposta ao histórico
            conversa.mensagens.push({
              tipo: 'bot',
              conteudo: `[TEXT_FORMAT]${confirmationMessage}[/END]`,
              data: new Date().toISOString()
            });

            await conversa.save();

            return {
              success: true,
              text: `[TEXT_FORMAT]${confirmationMessage}[/END]`,
              state: 5
            };
          }
        }
      }
    }

    // Verificação para não mencionar troco antes de ter a forma de pagamento
    if (conversa.state === 5) {
      // Se for a primeira mensagem neste estado, mostrar opções de pagamento
      if (message !== "5") { // Aqui assumo que o usuário não vai digitar literalmente "5"
        // Verificar se a mensagem atual é a primeira mensagem do usuário neste estado
        const mensagensNoEstado5 = conversa.mensagens.filter(msg =>
          msg.tipo === 'user' &&
          conversa.state === 5
        );

        // Se for a primeira mensagem do usuário neste estado, mostrar opções
        if (mensagensNoEstado5.length <= 1) { // 1 porque já incluímos a mensagem atual
          // Forçar que o modelo pergunte apenas sobre forma de pagamento
          // sem mencionar troco
          const paymentMsg = "Qual será a forma de pagamento? Temos as opções: Dinheiro, Cartão de crédito, Cartão de débito, PIX ou VR.";

          // Substituir a chamada ao modelo por uma resposta forçada
          const botResponse = `[TEXT_FORMAT]${paymentMsg}[/END]`;

          conversa.mensagens.push({
            tipo: 'bot',
            conteudo: botResponse,
            data: new Date().toISOString()
          });

          await conversa.save();

          return {
            success: true,
            text: botResponse
          };
        }
        // Se não for a primeira, verificar se precisa especificar tipo de cartão
        else {
          // Verificar se falta especificação de tipo de cartão
          const temCartao = message.toLowerCase().includes('cartão') ||
            message.toLowerCase().includes('cartao');
          const temCredito = message.toLowerCase().includes('credito') ||
            message.toLowerCase().includes('crédito');
          const temDebito = message.toLowerCase().includes('debito') ||
            message.toLowerCase().includes('débito');

          // Se mencionou cartão mas não especificou crédito nem débito, pedir clarificação
          if (temCartao && !temCredito && !temDebito) {
            // Resposta forçada pedindo para especificar
            const cartaoMsg = "Por favor, especifique se deseja pagar com cartão de crédito ou débito.";

            conversa.mensagens.push({
              tipo: 'bot',
              conteudo: `[TEXT_FORMAT]${cartaoMsg}[/END]`,
              data: new Date().toISOString()
            });

            await conversa.save();

            // Não avançar o estado até especificar o tipo
            return {
              success: true,
              text: `[TEXT_FORMAT]${cartaoMsg}[/END]`
            };
          }
        }
      }
    }

    // Quando o usuário finaliza o pedido (estado 6->7)
    if (conversa.state === 6 && (message.toLowerCase().includes('sim') ||
      message.toLowerCase().includes('correto') ||
      message.toLowerCase().includes('ok'))) {

      // Verificar se temos dados do pedido
      if (!conversa.pedidoData) {
        console.error('Dados do pedido ausentes na confirmação');
        return {
          success: true,
          text: "[TEXT_FORMAT]Desculpe, houve um problema com seu pedido. Poderia começar novamente?[/END]",
          state: 0 // Voltar ao estado inicial
        };
      }

      try {
        // Registrar o pedido no banco de dados
        const pedidoData = conversa.pedidoData;
        console.log('Dados do pedido encontrados:', JSON.stringify(pedidoData));

        // Garantir que o endereço tenha número
        let enderecoCompleto = pedidoData.endereco;

        // Se temos dados de endereço com número, usar esse
        if (conversa.addressData && conversa.addressData.components) {
          // Verificar se já há um número no endereço
          const temNumero = /\d+/.test(enderecoCompleto);
          console.log('Endereço tem número?', temNumero);

          if (!temNumero) {
            // Temos que extrair o número da mensagem ou histórico
            let numeroEndereco = null;

            // Procurar número nas últimas mensagens
            for (let i = conversa.mensagens.length - 1; i >= 0; i--) {
              const msg = conversa.mensagens[i];
              if (msg.tipo === 'user') {
                const numeroMatch = msg.conteudo.match(/número\s+(\d+)/i) ||
                  msg.conteudo.match(/,\s*(\d+)/) ||
                  msg.conteudo.match(/n[º°]\s*(\d+)/i);

                if (numeroMatch) {
                  numeroEndereco = numeroMatch[1];
                  console.log('Número encontrado na mensagem:', numeroEndereco);
                  break;
                }

                // Verificar se a mensagem contém apenas números
                const apenasNumeroMatch = msg.conteudo.match(/^\s*(\d+)\s*$/);
                if (apenasNumeroMatch && conversa.state === 4) {
                  numeroEndereco = apenasNumeroMatch[1];
                  console.log('Número isolado encontrado:', numeroEndereco);
                  break;
                }
              }
            }

            // Se encontramos número, formatar endereço completo
            if (numeroEndereco) {
              let components;
              if (typeof conversa.addressData.components === 'string') {
                components = JSON.parse(conversa.addressData.components);
              } else {
                components = conversa.addressData.components;
              }

              enderecoCompleto = `${components.street}, ${numeroEndereco}, ${components.neighborhood}, ${components.city} - ${components.state}, ${components.cep}`;
              console.log(`Endereço reformatado com número: ${enderecoCompleto}`);
            }
          }
        }

        // Calcular valor total para garantir
        let valorTotal = 0;
        pedidoData.items.forEach(item => {
          const quantidade = item.quantidade || 1;
          const preco = parseFloat(item.preco);
          valorTotal += preco * quantidade;
        });

        // Criar e salvar o pedido
        const novoPedido = new Pedido({
          telefone: conversa.telefone,
          itens: pedidoData.items,
          valorTotal: valorTotal,
          endereco: enderecoCompleto, // Usar o endereço com número
          formaPagamento: pedidoData.pagamento,
          status: 'Confirmado',
          data: new Date().toISOString()
        });

        const pedidoSalvo = await novoPedido.save();
        console.log(`Pedido confirmado e salvo: ${pedidoSalvo._id}`);

        // Atualizar a conversa atual
        conversa.pedidoId = pedidoSalvo._id;
        conversa.state = 7;  // Estado de pedido finalizado

        // Preparar mensagem de confirmação
        const confirmacao = `
[TEXT_FORMAT]🎉 *PEDIDO CONFIRMADO* 🎉

*Pizza ${pedidoData.items[0].nome}* - R$ ${parseFloat(pedidoData.items[0].preco).toFixed(2)}

*Endereço de entrega:* ${enderecoCompleto}
*Forma de pagamento:* ${novoPedido.formaPagamento}

*Total:* R$ ${valorTotal.toFixed(2)}

Seu pedido será entregue em aproximadamente 50 minutos. Obrigado pela preferência! 🍕[/END]
    `.trim();

        // Adicionar a mensagem de confirmação à conversa atual
        conversa.mensagens.push({
          tipo: 'bot',
          conteudo: confirmacao,
          data: new Date().toISOString()
        });

        // Salvar a conversa atual com estado 7 (finalizado)
        await conversa.save();

        // Criar nova conversa para próximas interações
        const novaConversa = new Conversa({
          telefone: conversa.telefone,
          inicio: new Date().toISOString(),
          duracao: 0,
          state: 0, // Estado inicial
          mensagens: [] // Começar com uma lista vazia de mensagens
        });

        // Salvar a nova conversa
        await novaConversa.save();
        console.log(`Nova conversa criada para futuras interações: ${novaConversa._id}`);

        // Verificar se temos o objeto de resposta gerado pelo LLM
        const botResponse = await processTaggedResponse(confirmacao, message, conversa, null);

        return botResponse;

      } catch (error) {
        console.error('Erro ao confirmar pedido:', error);
        return {
          success: true,
          text: "[TEXT_FORMAT]Desculpe, ocorreu um erro ao finalizar seu pedido. Por favor, tente novamente.[/END]",
          state: 6 // Manter no estado de confirmação
        };
      }
    }

    // Verificar pedido de imagem específica
    const imageRequestIds = detectImageRequest(message);
    if (imageRequestIds && imageRequestIds.length > 0) {
      console.log(`Pedido de imagem detectado: ${imageRequestIds.join(', ')}`);

      // Montar resposta com todas as imagens solicitadas
      let responseText = "";

      // Adicionar bloco de texto inicial sem pergunta
      if (imageRequestIds[0] === 'cardapio') {
        responseText = `[TEXT_FORMAT]Aqui está nosso cardápio:[/END]\n[IMAGE_FORMAT]cardapio[/END]`;
      } else if (imageRequestIds.length > 1) {
        // Texto inicial para múltiplas imagens
        responseText = `[TEXT_FORMAT]Aqui estão as imagens das pizzas solicitadas:[/END]`;

        // Adicionar uma tag de imagem para cada imagem solicitada
        for (let i = 0; i < imageRequestIds.length; i++) {
          responseText += `\n[IMAGE_FORMAT]${imageRequestIds[i]}[/END]`;
        }

        // Adicionar pergunta como texto separado no final
        responseText += `\n[TEXT_FORMAT]Gostaria de pedir alguma destas pizzas?[/END]`;
      } else {
        // Texto para uma única imagem
        responseText = `[TEXT_FORMAT]Aqui está a imagem da pizza solicitada:[/END]\n[IMAGE_FORMAT]${imageRequestIds[0]}[/END]\n[TEXT_FORMAT]Gostaria de pedir esta pizza?[/END]`;
      }

      // Adicionar resposta direta ao histórico da conversa
      conversa.mensagens.push({
        tipo: 'bot',
        conteudo: responseText,
        data: new Date().toISOString()
      });

      await conversa.save();

      // Processar resposta diretamente
      const processedResponse = await processTaggedResponse(responseText, message, conversa, await BotConfig.findOne());

      return processedResponse;
    }

    // Buscar configurações básicas do bot
    let botConfig;
    try {
      const cachedData = await getCachedData();
      botConfig = cachedData.botConfig;
      console.log('Configuração básica do bot carregada do cache');
    } catch (configError) {
      console.error('Erro ao carregar configuração do bot:', configError);
      botConfig = null;
    }

    // Buscar configurações completas para construir o contexto do LLM
    let historia, cardapioItems, formasPagamento;
    try {
      const cachedData = await getCachedData();
      historia = cachedData.historia;
      formasPagamento = cachedData.formasPagamento;
      cardapioItems = cachedData.cardapioItems;
      console.log('Configurações adicionais carregadas com sucesso');
    } catch (configError) {
      console.error('Erro ao carregar configurações adicionais:', configError);
      historia = null;
      cardapioItems = [];
      formasPagamento = [];
    }

    // Histórico de mensagens (até 10 últimas)
    const ultimas10Mensagens = conversa.mensagens.slice(-10);

    // Preparar mensagens para o modelo
    const mensagens = [
      // O system prompt será carregado do banco de dados
      {
        role: 'system',
        content: await getSystemPromptFromDatabase(botConfig, historia, cardapioItems, formasPagamento, conversa.state, conversa)
      }
    ];

    // Adicionar histórico de conversa
    ultimas10Mensagens.forEach(msg => {
      if (msg.tipo === 'user') {
        mensagens.push({
          role: 'user',
          content: msg.conteudo
        });
      } else {
        mensagens.push({
          role: 'assistant',
          content: msg.conteudo
        });
      }
    });

    // MODIFICAÇÃO: Adicionar lembrete explícito sobre o formato esperado
    if (mensagens.length > 1) {
      // Obter a última mensagem do usuário (a que estamos respondendo agora)
      const lastUserMsgIndex = mensagens.findIndex(m => m.role === 'user');

      if (lastUserMsgIndex !== -1) {
        // Modificar a mensagem do usuário para incluir o lembrete de formato
        const userOriginalMsg = mensagens[lastUserMsgIndex].content;
        mensagens[lastUserMsgIndex].content = `${userOriginalMsg}\n\nLEMBRETE: 
1. Você DEVE formatar sua resposta usando uma das seguintes tags: [TEXT_FORMAT], [VOICE_FORMAT], [IMAGE_FORMAT] ou [JSON_FORMAT], e terminar com [/END]. 
2. Se o usuário perguntar sobre uma pizza específica ou pedir para ver uma imagem, SEMPRE use [IMAGE_FORMAT]pizza-salgada_pizza-NOME_DA_PIZZA[/END] para mostrar a imagem.
3. Para o cardápio completo use [IMAGE_FORMAT]cardapio[/END].
4. Para pizza meio a meio use [IMAGE_FORMAT]pizza-salgada_pizza-SABOR1+pizza-salgada_pizza-SABOR2[/END].
5. Use [VOICE_FORMAT] APENAS quando o cliente solicitar informação por áudio. SEJA EXTREMAMENTE CONCISO, com frases curtas e sem introduções desnecessárias.
6. Nunca diga que não pode mostrar imagens - o sistema já tem todas as imagens armazenadas.
7. IMPORTANTE: Quando o usuário fornecer dados completos do pedido (pizza, endereço, pagamento), VOCÊ DEVE enviar um [JSON_FORMAT] com esses dados.
8. Quando usar [CONFIRMATION_FORMAT], DEVE também incluir [JSON_FORMAT] com os dados do pedido.
9. Use este formato para o JSON:
[JSON_FORMAT]
{
  "pedido": {
    "items": [{"nome": "Nome da Pizza", "quantidade": 1, "preco": 00.00}],
    "endereco": "Endereço completo com número",
    "pagamento": "Forma de pagamento"
  }
}
[/END]`;
      }
    }

    let botResponse;

    try {
      console.log(`Iniciando chamada à API OpenAI para ${userPhone}`);
      const openaiStartTime = Date.now();

      // Extrair a mensagem de sistema
      const systemMessage = mensagens.find(msg => msg.role === 'system')?.content || '';

      // Filtrar as mensagens de sistema e converter as demais para o formato do LLM
      const allMessages = mensagens
        .filter(msg => msg.role !== 'system')
        .map(msg => {
          if (msg.role === 'user') {
            return { role: 'user', content: msg.content };
          } else {
            return { role: 'assistant', content: msg.content };
          }
        });

      try {
        // Chamar a API GPT-4 e obter a resposta
        const completion = await openai.chat.completions.create({
          model: "gpt-4-turbo",
          messages: [
            { role: "system", content: systemMessage },
            ...allMessages
          ],
          max_tokens: 1000,
          temperature: 0.7
        });
        botResponse = completion.choices[0].message.content;

        if (conversa && botResponse) {
          const extractedPedido = await extractPedidoData(botResponse, conversa);
          if (extractedPedido) {
            console.log('Atualizando dados do pedido na conversa');

            // Salvar na conversa
            conversa.pedidoData = extractedPedido;

            // Armazenar também o texto JSON completo para referência
            const jsonMatch = botResponse.match(/\[JSON_FORMAT\]([\s\S]*?)\[\/END\]/);
            if (jsonMatch) {
              conversa.lastJsonData = jsonMatch[1];
            }

            try {
              await conversa.save();
              console.log('Dados do pedido atualizados com sucesso na conversa');
            } catch (saveError) {
              console.error('Erro ao salvar dados do pedido na conversa:', saveError);
            }
          }
        }

        const openaiEndTime = Date.now();
        console.log(`Resposta do OpenAI recebida para ${userPhone} em ${openaiEndTime - openaiStartTime}ms`);

      } catch (openaiError) {
        console.error('Erro na API da OpenAI:', openaiError);
        botResponse = "[TEXT_FORMAT]Desculpe, estou enfrentando alguns problemas técnicos no momento. Poderia tentar novamente em instantes?[/END]";
      }

      // Verificar se a resposta tem JSON de pedido
      if (botResponse.includes('[JSON_FORMAT]')) {
        console.log('Detectado possível pedido na resposta - extraindo JSON');
        try {
          const match = botResponse.match(/\[JSON_FORMAT\]([\s\S]*?)\[\/END\]/);
          if (match && match[1]) {
            const jsonString = match[1].trim();
            const jsonData = JSON.parse(jsonString);

            // Armazenar temporariamente
            if (conversa && conversa.telefone) {
              tempPedidoData.set(conversa.telefone, jsonData.pedido || jsonData);
              conversa.pedidoData = jsonData.pedido || jsonData;
              conversa.state = 6; // Mudar para estado de confirmação (não 7 ainda)
              await conversa.save();

              console.log('Dados de pedido armazenados temporariamente para', conversa.telefone);
            }
          }
        } catch (error) {
          console.error('Erro ao processar pedido:', error);
        }
      }

      // Verificar se o LLM está solicitando informações adicionais
      const needsHistory = botResponse.includes('[REQUEST_HISTORY]') || botResponse.includes('[/REQUEST_HISTORY]');
      const needsMenu = botResponse.includes('[REQUEST_MENU]') || botResponse.includes('[/REQUEST_MENU]');
      const needsPayment = botResponse.includes('[REQUEST_PAYMENT]') || botResponse.includes('[/REQUEST_PAYMENT]');

      // Se precisar de alguma informação adicional, fazer nova consulta com mais contexto
      if (needsHistory || needsMenu || needsPayment) {
        console.log('LLM sinalizou necessidade de informações adicionais');

        // Remover as tags de solicitação para não confundir o usuário
        botResponse = botResponse
          .replace('[REQUEST_HISTORY]', '').replace('[/REQUEST_HISTORY]', '')
          .replace('[REQUEST_MENU]', '').replace('[/REQUEST_MENU]', '')
          .replace('[REQUEST_PAYMENT]', '').replace('[/REQUEST_PAYMENT]', '')
          .trim();

        // Guardar essa resposta para referência
        const initialResponse = botResponse;

        // Preparar prompt enriquecido com informações solicitadas
        let additionalInfo = '';

        if (needsHistory && historia && historia.conteudo) {
          additionalInfo += `\n\n# HISTÓRIA DA PIZZARIA\n${historia.conteudo}\n`;
          console.log('Incluindo história da pizzaria no contexto');
        }

        if (needsMenu && cardapioItems && cardapioItems.length > 0) {
          additionalInfo += `\n\n# CARDÁPIO COMPLETO\n${formatCardapioForPrompt(cardapioItems)}\n`;
          console.log('Incluindo cardápio completo no contexto');
        }

        if (needsPayment && formasPagamento && formasPagamento.length > 0) {
          additionalInfo += `\n\n# FORMAS DE PAGAMENTO\n${formatPagamentoForPrompt(formasPagamento)}\n`;
          console.log('Incluindo formas de pagamento no contexto');
        }

        // Se informações adicionais foram incluídas, fazer nova consulta
        if (additionalInfo) {
          try {
            // Criar um novo prompt com as informações solicitadas
            const enrichedPrompt = `
              Você precisa responder a uma pergunta do cliente com mais detalhes.
              Você já deu esta resposta parcial: "${initialResponse}"
              
              Agora possui as seguintes informações adicionais para enriquecer sua resposta:
              ${additionalInfo}
              
              Por favor, reescreva sua resposta incorporando estas informações de forma natural.
              Use o mesmo estilo e tom da resposta anterior, mas inclua os detalhes relevantes.
              Lembre-se de formatar sua resposta com [TEXT_FORMAT], [VOICE_FORMAT], [IMAGE_FORMAT] ou [JSON_FORMAT] e terminar com [/END].
            `;

            // Fazer nova consulta à API 
            const enrichedCompletion = await openai.chat.completions.create({
              model: "gpt-4-turbo",
              max_tokens: 1000,
              temperature: 0.7,
              messages: [
                { role: "system", content: enrichedPrompt },
                { role: "user", content: message }
              ]
            });

            // Substituir a resposta original pela resposta enriquecida
            botResponse = enrichedCompletion.choices[0].message.content;
            console.log('Resposta enriquecida obtida com sucesso');

            // Verificar se a resposta contém pelo menos uma das tags exigidas
            if (
              !(botResponse.includes('[TEXT_FORMAT]') && botResponse.includes('[/END]')) &&
              !(botResponse.includes('[VOICE_FORMAT]') && botResponse.includes('[/END]')) &&
              !(botResponse.includes('[IMAGE_FORMAT]') && botResponse.includes('[/END]')) &&
              !(botResponse.includes('[JSON_FORMAT]') && botResponse.includes('[/END]'))
            ) {
              console.log('Resposta enriquecida sem formatação correta, aplicando formato padrão');
              botResponse = `[TEXT_FORMAT]${botResponse}[/END]`;
            }
          } catch (enrichError) {
            console.error('Erro ao obter resposta enriquecida:', enrichError);
            // Manter a resposta original (sem as tags de solicitação) em caso de erro
          }
        }
      }

      // Verificar se a resposta contém pelo menos uma das tags exigidas
      if (
        !(botResponse.includes('[TEXT_FORMAT]') && botResponse.includes('[/END]')) &&
        !(botResponse.includes('[VOICE_FORMAT]') && botResponse.includes('[/END]')) &&
        !(botResponse.includes('[IMAGE_FORMAT]') && botResponse.includes('[/END]')) &&
        !(botResponse.includes('[JSON_FORMAT]') && botResponse.includes('[/END]'))
      ) {
        console.log('Resposta sem formatação correta, aplicando formato padrão');
        botResponse = `[TEXT_FORMAT]${botResponse}[/END]`;
      }
    } catch (openaiError) {
      console.error('Erro na API da OpenAI:', openaiError);
      botResponse = "[TEXT_FORMAT]Desculpe, estou enfrentando alguns problemas técnicos no momento. Poderia tentar novamente em instantes?[/END]";
    }

    // Adicionar resposta original do bot à conversa
    conversa.mensagens.push({
      tipo: 'bot',
      conteudo: botResponse,
      data: new Date().toISOString()
    });

    // Atualizar estado baseado na resposta
    let shouldAdvanceState = false;
    try {
      const stateResult = checkIfShouldAdvanceState(botResponse, message, conversa.state, conversa);

      // Verificar se recebemos um objeto ou um booleano
      if (typeof stateResult === 'object') {
        shouldAdvanceState = stateResult.shouldAdvance;

        // Se precisamos do número do endereço, voltar para o estado 4
        if (stateResult.needAddressNumber) {
          conversa.state = 4; // Voltar para o estado de endereço

          // Adicionar mensagem solicitando número
          const addressRequestMsg = "Antes de confirmar seu pedido, preciso do número completo do seu endereço. Por favor, informe o número.";

          conversa.mensagens.push({
            tipo: 'bot',
            conteudo: `[TEXT_FORMAT]${addressRequestMsg}[/END]`,
            data: new Date().toISOString()
          });

          await conversa.save();

          return {
            success: true,
            text: `[TEXT_FORMAT]${addressRequestMsg}[/END]`,
            state: 4
          };
        }
      } else {
        shouldAdvanceState = stateResult;
      }

      console.log('Deve avançar estado?', shouldAdvanceState);

      if (shouldAdvanceState && conversa.state < 7) {
        conversa.state++;
        console.log('Novo estado:', conversa.state);
      } else if (conversa.state === 7) {
        // PROTEÇÃO: Se já estamos no estado 7 (confirmado), nunca regredir
        console.log('Estado mantido em 7 (pedido confirmado) - protegendo contra regressão');

        // Verificar se temos pedidoId, se não, algo está errado
        if (!conversa.pedidoId) {
          console.error('ALERTA: Estado 7 sem pedidoId - inconsistência detectada');
        }
      }

    } catch (stateError) {
      console.error('Erro ao verificar mudança de estado:', stateError);
      // Não mudar o estado em caso de erro
    }

    // Salvar conversa atualizada
    try {
      await conversa.save();
      console.log('Conversa salva com sucesso');
    } catch (saveError) {
      console.error('Erro ao salvar conversa:', saveError);
      // Continuar mesmo se falhar ao salvar
    }

    const responseObj = await processTaggedResponse(botResponse, message, conversa, botConfig);

    const apiRequestEndTime = Date.now();
    const totalTime = apiRequestEndTime - apiRequestStartTime;
    console.log(`[${new Date().toISOString()}] Processamento completo para ${userPhone} em ${totalTime}ms`);
    if (totalTime > 5000) {
      console.warn(`⚠️ Processamento lento detectado (${totalTime}ms) para ${userPhone}`);
    }

    // Retornar a resposta
    return responseObj;
  } catch (error) {
    // Tratamento de erro global
    console.error('ERRO CRÍTICO no processamento da mensagem:', error);
    return {
      success: false,
      error: 'Erro interno do servidor',
      text: "[TEXT_FORMAT]Desculpe, ocorreu um erro ao processar sua mensagem.[/END]"
    };
  }
}

// ======== ROTAS DA API ==========

// Endpoint de verificação de saúde
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Endpoint para buscar imagem por ID
app.post('/api/get-image-by-id', async (req, res) => {
  try {
    const { imageId } = req.body;

    if (!imageId) {
      return res.status(400).json({
        success: false,
        message: 'ID de imagem não fornecido'
      });
    }

    console.log(`Processando solicitação de imagem por ID: ${imageId}`);

    // Buscar a imagem no banco de dados
    let item = await CardapioItem.findOne({
      identificador: imageId,
      disponivel: true
    });

    // Se não encontrou pelo identificador exato, tenta buscar pelo nome da pizza no ID
    if (!item && imageId.includes('pizza-')) {
      const pizzaName = imageId.split('_pizza-')[1] || imageId.split('-pizza-')[1];
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
          { identificador: { $regex: new RegExp(imageId, 'i') } },
          { nome: { $regex: new RegExp(imageId, 'i') } }
        ],
        disponivel: true
      });
    }

    if (!item || !item.imagemGeral) {
      return res.status(404).json({
        success: false,
        message: 'Imagem não encontrada'
      });
    }

    // Retornar apenas os dados da imagem (sem processar)
    res.json({
      success: true,
      imageUrl: item.imagemGeral,
      caption: `*${item.nome}*: ${item.descricao || ''}`
    });
  } catch (error) {
    console.error('Erro ao buscar imagem por ID:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar imagem'
    });
  }
});

// Endpoint para processamento de mensagem
app.post('/api/message', async (req, res) => {
  try {
    const { phone, message, isAudio, messageType, isFirstMessage, timestamp } = req.body;

    // Validação básica
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Número de telefone é obrigatório'
      });
    }

    if (message === undefined || message === null) {
      return res.status(400).json({
        success: false,
        error: 'Mensagem é obrigatória'
      });
    }

    // Buscar ou criar conversa
    let conversa = await getOrCreateConversation(phone, message);
    if (!conversa) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao obter conversa'
      });
    }

    // Processar mensagem internamente
    const response = await processMessageInternally(phone, message, isAudio, messageType, conversa);

    // Enviar a resposta
    return res.json(response);
  } catch (error) {
    console.error('ERRO na rota /api/message:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      text: "Desculpe, ocorreu um erro ao processar sua mensagem."
    });
  }
});

// Endpoint para validação de endereço
app.post('/api/validate-address', async (req, res) => {
  const { address } = req.body;

  if (!address) {
    return res.status(400).json({
      success: false,
      message: 'Endereço não fornecido'
    });
  }

  try {
    // Validar endereço
    const result = await validateAddress(address);
    res.json(result);
  } catch (error) {
    console.error('Erro ao validar endereço:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao validar endereço'
    });
  }
});

// Endpoint para gerar áudio
app.post('/api/generate-audio', async (req, res) => {
  try {
    const { text, pedidoId } = req.body;

    if (!text && !pedidoId) {
      return res.status(400).json({
        success: false,
        error: 'Texto ou ID de pedido é obrigatório'
      });
    }

    // Determinar qual texto usar para gerar o áudio
    let audioText = text;

    // Se tiver um ID de pedido, buscar dados do pedido e gerar texto de confirmação
    if (pedidoId) {
      try {
        const pedido = await Pedido.findById(pedidoId);
        if (pedido) {
          audioText = gerarTextoConfirmacaoPedido({
            items: pedido.itens,
            endereco: pedido.endereco,
            pagamento: pedido.formaPagamento
          });
        }
      } catch (pedidoError) {
        console.error('Erro ao buscar pedido:', pedidoError);
      }
    }

    if (!audioText) {
      return res.status(400).json({
        success: false,
        error: 'Não foi possível gerar o texto para áudio'
      });
    }

    // Limpar o texto para garantir melhor qualidade de áudio
    const cleanedText = audioText
      .replace(/<\/?[^>]+(>|$)/g, "") // Remove tags HTML
      .replace(/\*\*/g, "") // Remove negrito markdown
      .replace(/\*/g, "") // Remove itálico markdown
      .substring(0, 4000); // Limitar para evitar erro da API

    // Verificar se temos a API KEY da OpenAI configurada
    if (!process.env.OPENAI_API_KEY) {
      console.error('API key da OpenAI não configurada');
      return res.status(500).json({
        success: false,
        error: 'Serviço de áudio não configurado'
      });
    }

    // Gerar áudio
    const audioUrl = await generateAudio(cleanedText);
    if (!audioUrl) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao gerar áudio'
      });
    }

    return res.json({
      success: true,
      audio: audioUrl
    });
  } catch (error) {
    console.error('Erro geral ao gerar áudio:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar áudio',
      message: error.message
    });
  }
});

// Rotas adicionais da API
// Categoria
app.get('/api/categorias', async (req, res) => {
  try {
    const categorias = await Categoria.find({ ativo: true }).sort({ ordem: 1 });
    res.json(categorias);
  } catch (error) {
    console.error('Erro ao buscar categorias:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar categorias' });
  }
});

app.post('/api/categorias', async (req, res) => {
  try {
    const { nome } = req.body;

    if (!nome) {
      return res.status(400).json({ success: false, message: 'Nome da categoria é obrigatório' });
    }

    // Check if category already exists
    const existente = await Categoria.findOne({ nome });
    if (existente) {
      return res.status(400).json({ success: false, message: 'Esta categoria já existe' });
    }

    // Get highest order for new category
    const maxOrdem = await Categoria.findOne().sort({ ordem: -1 });
    const ordem = maxOrdem ? maxOrdem.ordem + 1 : 1;

    const novaCategoria = await Categoria.create({
      nome,
      ordem,
      ativo: true
    });

    res.json({ success: true, categoria: novaCategoria });
  } catch (error) {
    console.error('Erro ao adicionar categoria:', error);
    res.status(500).json({ success: false, message: 'Erro ao adicionar categoria' });
  }
});

global.qrCodeImage = null;
global.whatsappConnected = false;

// Rota para visualizar o QR code
app.get('/qrcode', (req, res) => {
  if (global.qrCodeImage) {
    res.send(`
      <html>
        <head>
          <title>WhatsApp QR Code</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
            img { max-width: 100%; height: auto; margin: 20px auto; display: block; }
            .container { max-width: 500px; margin: 0 auto; padding: 20px; }
            .status { margin: 20px 0; padding: 10px; border-radius: 5px; }
            .connected { background-color: #d4edda; color: #155724; }
            .waiting { background-color: #fff3cd; color: #856404; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>WhatsApp QR Code</h1>
            ${global.whatsappConnected 
              ? '<div class="status connected">✅ WhatsApp conectado!</div>' 
              : '<div class="status waiting">⏳ Escaneie o código QR com o WhatsApp no seu celular</div>'}
            <img src="${global.qrCodeImage}" alt="QR Code para WhatsApp Web"/>
            <p>Escaneie este código com o seu aplicativo WhatsApp para conectar o bot.</p>
            <button onclick="location.reload()">Atualizar</button>
          </div>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
        <head>
          <title>WhatsApp QR Code</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
            .container { max-width: 500px; margin: 0 auto; padding: 20px; }
            .status { margin: 20px 0; padding: 10px; border-radius: 5px; }
            .waiting { background-color: #fff3cd; color: #856404; }
            .connected { background-color: #d4edda; color: #155724; }
          </style>
          <meta http-equiv="refresh" content="5">
        </head>
        <body>
          <div class="container">
            <h1>WhatsApp QR Code</h1>
            ${global.whatsappConnected 
              ? '<div class="status connected">✅ WhatsApp conectado!</div>' 
              : '<div class="status waiting">⏳ Aguardando geração do QR code...</div>'}
            <p>A página será atualizada automaticamente em 5 segundos.</p>
            <button onclick="location.reload()">Atualizar agora</button>
          </div>
        </body>
      </html>
    `);
  }
});

// Configuração do Bot
app.get('/api/bot-config', async (req, res) => {
  try {
    const config = await BotConfig.findOne();
    res.json(config || {});
  } catch (error) {
    console.error('Erro ao buscar configuração do bot:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar configuração' });
  }
});

app.put('/api/bot-config', async (req, res) => {
  try {
    const config = await BotConfig.findOne();

    if (config) {
      // Atualizar configuração existente
      const updatedConfig = await BotConfig.findOneAndUpdate({}, req.body, { new: true });
      res.json(updatedConfig);
    } else {
      // Criar nova configuração se não existir
      const newConfig = await BotConfig.create(req.body);
      res.json(newConfig);
    }
  } catch (error) {
    console.error('Erro ao atualizar configuração do bot:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar configuração' });
  }
});

// Cardápio
app.get('/api/cardapio', async (req, res) => {
  try {
    // Buscar categorias e itens
    const categorias = await Categoria.find();
    const items = await CardapioItem.find();

    // Preparar mapeamento de IDs para nomes
    const idParaNome = {};
    categorias.forEach(cat => {
      idParaNome[cat._id.toString()] = cat.nome;
    });

    // Processar itens para adicionar nome de categoria quando necessário
    const itemsProcessados = items.map(item => {
      const obj = item.toObject();

      // Adicionar campo categoriaNome para facilitar filtragem no frontend
      if (item.categoria) {
        if (typeof item.categoria === 'string') {
          if (mongoose.Types.ObjectId.isValid(item.categoria) &&
            idParaNome[item.categoria]) {
            obj.categoriaNome = idParaNome[item.categoria];
          } else {
            obj.categoriaNome = item.categoria;
          }
        } else if (item.categoria.toString && idParaNome[item.categoria.toString()]) {
          obj.categoriaNome = idParaNome[item.categoria.toString()];
        }
      }

      return obj;
    });

    res.json({
      categorias: categorias.map(c => c.nome),
      items: itemsProcessados
    });
  } catch (error) {
    console.error('Erro ao buscar cardápio:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar cardápio' });
  }
});

// Upload de imagem para Cloudinary
async function uploadToCloudinary(file, folder = 'pizzaria') {
  try {
    // Ler o arquivo do sistema
    const imageBuffer = fs.readFileSync(file.path);

    // Converter para Base64 (necessário para o upload via API)
    const base64Image = `data:${file.mimetype};base64,${imageBuffer.toString('base64')}`;

    // Fazer upload para o Cloudinary
    const result = await cloudinary.uploader.upload(base64Image, {
      folder: folder,
      resource_type: 'image'
    });

    // Remover o arquivo temporário
    fs.unlinkSync(file.path);

    // Retornar a URL segura da imagem
    return result.secure_url;
  } catch (error) {
    console.error('Erro ao fazer upload para Cloudinary:', error);
    throw error;
  }
}

// Pedidos
app.get('/api/pedidos', async (req, res) => {
  try {
    const pedidos = await Pedido.find().sort({ data: -1 });
    res.json(pedidos);
  } catch (error) {
    console.error('Erro ao buscar pedidos:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar pedidos' });
  }
});

app.get('/api/pedidos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pedido = await Pedido.findById(id);

    if (!pedido) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    }

    res.json(pedido);
  } catch (error) {
    console.error('Erro ao buscar pedido:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar pedido' });
  }
});

// Conversas
app.get('/api/conversas', async (req, res) => {
  try {
    const conversas = await Conversa.find().sort({ inicio: -1 });
    res.json(conversas);
  } catch (error) {
    console.error('Erro ao buscar conversas:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar conversas' });
  }
});

app.get('/api/conversas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const conversa = await Conversa.findById(id);

    if (!conversa) {
      return res.status(404).json({ success: false, message: 'Conversa não encontrada' });
    }

    res.json(conversa);
  } catch (error) {
    console.error('Erro ao buscar conversa:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar conversa' });
  }
});

// ======== INICIALIZAÇÃO ==========

client.on('qr', (qr) => {
  console.log('[INFO] QR Code gerado. Escaneie com seu WhatsApp:');
  
  // Armazenar o QR code mais recente
  latestQR = qr;
  
  // Gerar o link para o QR code
  const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  console.log(`\n📱 Link para QR code: ${qrLink}\n`);
  
  // Exibir no console para debugging
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('[SUCESSO] Autenticado com sucesso no WhatsApp!');
});

client.on('ready', () => {
  console.log('[BOT PRONTO] WhatsApp conectado e operando normalmente!');
  isClientReady = true;
  latestQR = null; // Limpar o QR code
  
  // Iniciar o servidor agora que estamos conectados
  startServer();
});


// Tentativa de reconexão automática do WhatsApp
client.on('disconnected', (reason) => {
  console.log('[ERRO] Cliente WhatsApp desconectado:', reason);

  setTimeout(() => {
    console.log('[INFO] Tentando reconectar WhatsApp...');
    client.initialize();
  }, 10000); // Tentar reconectar após 10 segundos
});

// Processar mensagens recebidas no WhatsApp
client.on('message', async (message) => {
  try {
    const messageStartTime = Date.now();
    console.log(`[${new Date().toISOString()}] Mensagem WhatsApp recebida de ${message.from}. ID: ${message.id.id}`);

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
    console.error('Erro ao processar mensagem WhatsApp:', error);
    try {
      await client.sendMessage(message.from, 'Desculpe, ocorreu um erro. Por favor, tente novamente mais tarde.');
    } catch (e) {
      console.error('Não foi possível enviar mensagem de erro:', e);
    }
  }
});

// Inicialização do servidor e aplicativos
// Adicione esta função para configurar o ngrok
async function setupNgrok(port) {
  try {
    // Caminho para o binário do ngrok (ajuste conforme sua instalação)
    const ngrokPath = './ngrok';
    const { exec } = require('child_process');
    
    // Iniciar ngrok como um processo separado
    console.log('🚀 Iniciando ngrok...');
    const ngrokProcess = exec(`${ngrokPath} http ${port}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Erro na execução do ngrok: ${error}`);
        return;
      }
      console.log(`Saída do ngrok: ${stdout}`);
      if (stderr) console.error(`Erros do ngrok: ${stderr}`);
    });
    
    // Aguardar um momento para o ngrok iniciar e abrir API
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Consultar URL do túnel via API do ngrok
    try {
      const response = await axios.get('http://127.0.0.1:4040/api/tunnels');
      const tunnel = response.data.tunnels[0];
      if (tunnel && tunnel.public_url) {
        const url = tunnel.public_url;
        console.log(`✅ Túnel ngrok criado: ${url}`);
        console.log(`🔍 Acesse o QR code em: ${url}/qrcode`);
        return url;
      } else {
        console.error('❌ Nenhum túnel encontrado na resposta do ngrok');
        return null;
      }
    } catch (apiError) {
      console.error('❌ Erro ao consultar API do ngrok:', apiError.message);
      console.log('🔄 Tentando alternativa: Executando ngrok em modo não-detached');
      
      // Modo alternativo: usar a porta padrão
      console.log(`⚠️ Usando fallback: Acesse o QR code em: http://localhost:${port}/qrcode`);
      console.log('⚠️ Para acesso externo, você precisará expor essa porta manualmente');
      return `http://localhost:${port}`;
    }
  } catch (error) {
    console.error('❌ Erro geral ao iniciar ngrok:', error);
    return null;
  }
}

// Adicione esta rota para exibir o QR code
app.get('/qrcode', (req, res) => {
  if (global.qrCodeImage) {
    res.send(`
      <html>
        <head>
          <title>WhatsApp QR Code</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
            img { max-width: 100%; height: auto; margin: 20px auto; display: block; }
            .container { max-width: 500px; margin: 0 auto; padding: 20px; }
            .status { margin: 20px 0; padding: 10px; border-radius: 5px; }
            .connected { background-color: #d4edda; color: #155724; }
            .waiting { background-color: #fff3cd; color: #856404; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>WhatsApp QR Code</h1>
            ${global.whatsappConnected 
              ? '<div class="status connected">✅ WhatsApp conectado!</div>' 
              : '<div class="status waiting">⏳ Escaneie o código QR com o WhatsApp no seu celular</div>'}
            <img src="${global.qrCodeImage}" alt="QR Code para WhatsApp Web"/>
            <p>Escaneie este código com o seu aplicativo WhatsApp para conectar o bot.</p>
            <button onclick="location.reload()">Atualizar</button>
          </div>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
        <head>
          <title>WhatsApp QR Code</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
            .container { max-width: 500px; margin: 0 auto; padding: 20px; }
            .status { margin: 20px 0; padding: 10px; border-radius: 5px; }
            .waiting { background-color: #fff3cd; color: #856404; }
            .connected { background-color: #d4edda; color: #155724; }
          </style>
          <meta http-equiv="refresh" content="5">
        </head>
        <body>
          <div class="container">
            <h1>WhatsApp QR Code</h1>
            ${global.whatsappConnected 
              ? '<div class="status connected">✅ WhatsApp conectado!</div>' 
              : '<div class="status waiting">⏳ Aguardando geração do QR code...</div>'}
            <p>A página será atualizada automaticamente em 5 segundos.</p>
            <button onclick="location.reload()">Atualizar agora</button>
          </div>
        </body>
      </html>
    `);
  }
});

// Modifique o evento 'qr' do cliente WhatsApp
client.on('qr', async (qr) => {
  console.log('[INFO] QR Code gerado. Escaneie com seu WhatsApp:');
  
  // Armazenar o QR code como imagem base64 para exibição via web
  const qrcode = require('qrcode');
  global.qrCodeImage = await qrcode.toDataURL(qr);
  global.whatsappConnected = false;
  
  // Exibir no console para debugging
  qrcode.generate(qr, { small: true });
});

// Adicione um evento para quando o WhatsApp conectar
client.on('ready', () => {
  console.log('[BOT PRONTO] WhatsApp conectado e operando normalmente.');
  global.whatsappConnected = true;
});

let isClientReady = false;
let latestQR = null;

// Modifique a função startServer() para incluir a configuração do ngrok
function startServer() {
  if (!isClientReady) {
    console.log("⏳ Aguardando o WhatsApp conectar antes de iniciar o servidor...");
    
    // Se tivermos um QR code disponível, exibimos o link
    if (latestQR) {
      const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQR)}`;
      console.log(`\n🔍 Escaneie o QR code com seu WhatsApp:`);
      console.log(`📱 ${qrLink}\n`);
    }
    
    // Verificar novamente após um tempo
    setTimeout(startServer, 3000);
    return;
  }
  
  // Se chegou aqui, o cliente está pronto, podemos iniciar o servidor
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
  });
}

// Iniciar o servidor
startServer();

// Exportar variáveis e funções importantes para uso em outros módulos
module.exports = {
  app,
  client,
  processMessageInternally,
  processTaggedResponse,
  generateAudio
};
