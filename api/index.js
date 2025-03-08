const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const dotenv = require('dotenv');
const axios = require('axios');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');
const cloudinary = require('cloudinary').v2;

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

// Carregar variáveis de ambiente
dotenv.config();

cloudinary.config({
  cloud_name: 'dg4zmbjmt',
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET
});

// Inicializar Express
const app = express();
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'http://localhost:3001';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));  // Aumenta o limite para 10MB
app.use(express.urlencoded({ limit: '10mb', extended: true }));  // Para uploads via formulário
app.use(bodyParser.json());
app.use('/api/media', express.static(path.join(__dirname, 'public', 'media')));

// Conexão com MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Conectado ao MongoDB');
  // Inicializar dados padrão se necessário
  initializeDB();
}).catch(err => {
  console.error('Erro ao conectar com MongoDB:', err);
});


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

// Inicializar banco de dados com dados padrão, se necessário
async function initializeDB() {
  try {
    // Verificar se já existe configuração do bot
    const botConfigCount = await BotConfig.countDocuments();
    if (botConfigCount === 0) {
      await BotConfig.create({
        nome: "",
        descricao: "",
        personalidade: "",
        procedimento: "",
        regras: "",
        welcomeMessage: "",
        unsupportedMediaMessage: "",
        menuImage: "",
        menuImageCaption: "",
        confirmationImage: "",
        confirmationImageCaption: "",
        // Novo campo para armazenar o prompt do sistema
        systemPrompt: "",
        // Novo campo para armazenar a instrução de formato
        formatInstruction: "[TEXT_FORMAT], [VOICE_FORMAT], [IMAGE_FORMAT] ou [JSON_FORMAT] seguido de [/END]",
      });
      console.log('Configuração inicial do bot criada');
    }

    // Verificar se já existe história da pizzaria
    const historiaCount = await PizzariaHistoria.countDocuments();
    if (historiaCount === 0) {
      await PizzariaHistoria.create({
        titulo: "",
        conteudo: "",
        imagem: ""
      });
      console.log('História da pizzaria inicializada');
    }

    // Verificar configuração de entrega
    const deliveryConfigCount = await DeliveryConfig.countDocuments();
    if (deliveryConfigCount === 0) {
      await DeliveryConfig.create({
        enabled: true,
        areas: [
          { city: "São Paulo", state: "SP", active: true }
        ],
        restrictions: {
          limitToSpecificAreas: false,
          maxDistance: 0,
          additionalFeePerKm: 0
        },
        messages: {
          outsideAreaMessage: "Desculpe, não entregamos nesse endereço no momento.",
          partialAddressMessage: "Por favor, forneça o endereço completo com número e bairro."
        }
      });
      console.log('Configuração de entrega inicializada');
    }

    // Verificar chaves de API
    const apiKeysCount = await ApiKeys.countDocuments();
    if (apiKeysCount === 0) {
      await ApiKeys.create({
        googleMaps: ""
      });
      console.log('Chaves de API inicializadas');
    }
  } catch (error) {
    console.error('Erro ao inicializar o banco de dados:', error);
  }
}

// === VALIDAÇÃO DE ENDEREÇOS ===

async function detectAndValidateCEP(message) {
  const cepMatch = message.match(/(\d{5})-?\s*?(\d{3})/); // Captura CEPs em vários formatos
  if (cepMatch) {
    const cep = cepMatch[1] + cepMatch[2]; // Remove hífen ou espaço
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
  return null; // Retorna null se não encontrar CEP ou falhar na validação
}

/**
 * Valida e completa informações de endereço
 * @param {string} address - Endereço parcial informado pelo usuário
 * @param {boolean} isQuery - Se é apenas uma consulta sobre área de entrega
 * @returns {Promise<object>} - Objeto com endereço validado ou mensagem de erro
 */
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
        // Consultar API de CEP (exemplo usando BrasilAPI)
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

/**
 * Determina o nível de precisão do endereço
 * @param {Array<string>} types - Tipos de endereço retornados pela API
 * @returns {string} - 'high', 'medium' ou 'low'
 */
function getPrecisionLevel(types) {
  if (types.includes('street_address') || types.includes('premise')) {
    return 'high'; // Endereço completo com número
  } else if (types.includes('route')) {
    return 'medium'; // Rua sem número
  } else {
    return 'low'; // Apenas bairro, cidade ou genérico
  }
}

/**
 * Verifica se o endereço está dentro da área de entrega
 * @param {object} components - Componentes do endereço
 * @returns {Promise<boolean>} - true se estiver na área de entrega
 */
async function checkDeliveryArea(components) {
  // Buscar configuração de entrega
  const deliveryConfig = await DeliveryConfig.findOne();

  // Se a validação estiver desabilitada ou não houver configuração
  if (!deliveryConfig || !deliveryConfig.enabled) {
    return true;
  }

  // Se não estiver limitado a áreas específicas
  if (!deliveryConfig.restrictions.limitToSpecificAreas) {
    return true;
  }

  // VERIFICAÇÃO SIMPLES E DEFINITIVA:
  // Se a cidade não é São Paulo, não entregamos
  if (!components.localidade || components.localidade !== "São Paulo") {
    console.log(`Endereço fora da área de entrega. Cidade: ${components.localidade || "não identificada"}`);
    return false;
  }

  // Se o estado não é SP, não entregamos
  if (!components.administrativeArea || components.administrativeArea !== "SP") {
    console.log(`Endereço fora do estado. Estado: ${components.administrativeArea || "não identificado"}`);
    return false;
  }

  // Se chegou até aqui, o endereço está em São Paulo - SP
  return true;
}

const dataCache = {
  botConfig: null,
  historia: null,
  cardapioBasico: null,
  formasPagamento: null,
  lastUpdated: 0
};

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

// =================== ENDPOINTS DA API =====================

// Endpoint de verificação de saúde
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

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

// === Configuração do Bot ===
app.get('/api/bot-config', async (req, res) => {
  console.log('Rota /api/bot-config foi chamada');
  try {
    const config = await BotConfig.findOne();
    console.log('Configuração encontrada:', config);
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

// Buscar configuração de interação
app.get('/api/interaction-config', async (req, res) => {
  try {
    const botConfig = await BotConfig.findOne();
    res.json(botConfig.interactionRules || {});
  } catch (error) {
    console.error('Erro ao buscar configuração de interação:', error);
    res.status(500).json({ error: 'Erro ao buscar configuração' });
  }
});

// Salvar configuração de interação
app.post('/api/interaction-config', async (req, res) => {
  try {
    const botConfig = await BotConfig.findOne();
    botConfig.interactionRules = req.body;
    await botConfig.save();
    res.json({ success: true, message: 'Configurações salvas' });
  } catch (error) {
    console.error('Erro ao salvar configuração de interação:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração' });
  }
});

// === História da Pizzaria ===
app.get('/api/historia', async (req, res) => {
  try {
    const historia = await PizzariaHistoria.findOne();
    res.json(historia || {});
  } catch (error) {
    console.error('Erro ao buscar história da pizzaria:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar história' });
  }
});

app.post('/api/historia', async (req, res) => {
  try {
    const historia = await PizzariaHistoria.findOne();
    if (historia) {
      // Atualizar história existente
      await PizzariaHistoria.updateOne({}, req.body);
    } else {
      // Criar nova história
      await PizzariaHistoria.create(req.body);
    }
    res.json({ success: true, message: 'História salva com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar história da pizzaria:', error);
    res.status(500).json({ success: false, message: 'Erro ao salvar história' });
  }
});

app.get('/api/categorias', async (req, res) => {
  try {
    const categorias = await Categoria.find({ ativo: true }).sort({ ordem: 1 });
    res.json(categorias);
  } catch (error) {
    console.error('Erro ao buscar categorias:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar categorias' });
  }
});

// Add category
app.post('/api/categorias', async (req, res) => {
  try {
    console.log('Requisição para criar categoria recebida:', req.body);
    const { nome } = req.body;

    if (!nome) {
      console.log('ERRO: Nome da categoria não fornecido');
      return res.status(400).json({ success: false, message: 'Nome da categoria é obrigatório' });
    }

    console.log('Verificando se categoria já existe:', nome);
    // Check if category already exists
    const existente = await Categoria.findOne({ nome });
    if (existente) {
      console.log('Categoria já existe:', existente);
      return res.status(400).json({ success: false, message: 'Esta categoria já existe' });
    }

    console.log('Buscando ordem máxima para nova categoria');
    // Get highest order for new category
    const maxOrdem = await Categoria.findOne().sort({ ordem: -1 });
    const ordem = maxOrdem ? maxOrdem.ordem + 1 : 1;
    console.log('Ordem para nova categoria:', ordem);

    console.log('Criando nova categoria com dados:', { nome, ordem });
    const novaCategoria = await Categoria.create({
      nome,
      ordem,
      ativo: true // Garantir que está ativo por padrão
    });

    console.log('Nova categoria criada:', novaCategoria);
    res.json({ success: true, categoria: novaCategoria });
  } catch (error) {
    console.error('Erro detalhado ao adicionar categoria:', error);
    // Mostrar mais detalhes do erro
    if (error.name === 'ValidationError') {
      console.error('Erro de validação:', error.errors);
    }
    res.status(500).json({ success: false, message: 'Erro ao adicionar categoria' });
  }
});

// Update category
app.put('/api/categorias/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, ordem, ativo } = req.body;

    const categoria = await Categoria.findByIdAndUpdate(
      id,
      { nome, ordem, ativo },
      { new: true }
    );

    if (!categoria) {
      return res.status(404).json({ success: false, message: 'Categoria não encontrada' });
    }

    res.json({ success: true, categoria });
  } catch (error) {
    console.error('Erro ao atualizar categoria:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar categoria' });
  }
});

// Delete category
app.delete('/api/categorias/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category is in use
    const itemComCategoria = await CardapioItem.findOne({ categoria: id });
    if (itemComCategoria) {
      return res.status(400).json({
        success: false,
        message: 'Esta categoria não pode ser removida pois está em uso'
      });
    }

    const resultado = await Categoria.findByIdAndDelete(id);
    if (!resultado) {
      return res.status(404).json({ success: false, message: 'Categoria não encontrada' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover categoria:', error);
    res.status(500).json({ success: false, message: 'Erro ao remover categoria' });
  }
});

app.get('/api/cardapio', async (req, res) => {
  try {
    // Buscar categorias e itens
    const categorias = await Categoria.find();
    const items = await CardapioItem.find();

    console.log('Categorias encontradas:', categorias.length);
    console.log('Itens encontrados:', items.length);

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
            // É um ID válido e encontramos o nome
            obj.categoriaNome = idParaNome[item.categoria];
          } else {
            // Não é ID ou não encontramos no mapa, usar o valor como está
            obj.categoriaNome = item.categoria;
          }
        } else if (item.categoria.toString && idParaNome[item.categoria.toString()]) {
          // É um ObjectId e encontramos o nome
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

// No endpoint POST /api/cardapio/item
app.post('/api/cardapio/item', upload.fields([
  { name: 'imagemGeral', maxCount: 1 },
  { name: 'imagemEsquerda', maxCount: 1 },
  { name: 'imagemDireita', maxCount: 1 }
]), async (req, res) => {
  try {
    const { nome, descricao, inspiracao, categoria, preco, disponivel, identificador } = req.body;
    const files = req.files;

    // Verificar e processar categoria (código existente)
    let categoriaValue = categoria;
    if (mongoose.Types.ObjectId.isValid(categoria)) {
      categoriaValue = categoria;
    } else {
      try {
        const categoriaObj = await Categoria.findOne({ nome: categoria });
        if (categoriaObj) {
          categoriaValue = categoriaObj._id;
          console.log(`Categoria encontrada: ${categoriaObj.nome} (${categoriaObj._id})`);
        } else {
          console.log(`Categoria não encontrada: ${categoria}, usando como string`);
        }
      } catch (err) {
        console.error('Erro ao buscar categoria:', err);
      }
    }

    // Upload de imagens para o Cloudinary
    const imagemGeralUrl = files.imagemGeral ? await uploadToCloudinary(files.imagemGeral[0]) : null;
    const imagemEsquerdaUrl = files.imagemEsquerda ? await uploadToCloudinary(files.imagemEsquerda[0]) : null;
    const imagemDireitaUrl = files.imagemDireita ? await uploadToCloudinary(files.imagemDireita[0]) : null;

    // Criar item no banco de dados com as URLs
    const novoItem = await CardapioItem.create({
      nome,
      descricao,
      inspiracao,
      categoria: categoriaValue,
      preco: parseFloat(preco),
      disponivel: disponivel === 'true',
      imagemGeral: imagemGeralUrl,
      imagemEsquerda: imagemEsquerdaUrl,
      imagemDireita: imagemDireitaUrl,
      identificador
    });

    res.json(novoItem);
  } catch (error) {
    console.error('Erro ao adicionar item ao cardápio:', error);
    res.status(500).json({ success: false, message: 'Erro ao adicionar item' });
  }
});

app.put('/api/cardapio/item/:id', upload.fields([
  { name: 'imagemGeral', maxCount: 1 },
  { name: 'imagemEsquerda', maxCount: 1 },
  { name: 'imagemDireita', maxCount: 1 }
]), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, descricao, inspiracao, categoria, preco, disponivel, identificador } = req.body;
    const files = req.files;

    // Verificar e processar categoria (código existente)
    let categoriaValue = categoria;
    if (mongoose.Types.ObjectId.isValid(categoria)) {
      categoriaValue = categoria;
    } else {
      try {
        const categoriaObj = await Categoria.findOne({ nome: categoria });
        if (categoriaObj) {
          categoriaValue = categoriaObj._id;
        } else {
          console.log(`Categoria não encontrada: ${categoria}, usando como string`);
        }
      } catch (err) {
        console.error('Erro ao buscar categoria:', err);
      }
    }

    // Buscar item atual para verificar quais imagens já existem
    const itemAtual = await CardapioItem.findById(id);
    if (!itemAtual) {
      return res.status(404).json({ success: false, message: 'Item não encontrado' });
    }

    // Dados para atualização
    const updateData = {
      nome,
      descricao,
      inspiracao,
      categoria: categoriaValue,
      preco: parseFloat(preco),
      disponivel: disponivel === 'true',
      identificador
    };

    // Processar cada imagem apenas se foi enviada
    if (files.imagemGeral) {
      updateData.imagemGeral = await uploadToCloudinary(files.imagemGeral[0]);
    }
    if (files.imagemEsquerda) {
      updateData.imagemEsquerda = await uploadToCloudinary(files.imagemEsquerda[0]);
    }
    if (files.imagemDireita) {
      updateData.imagemDireita = await uploadToCloudinary(files.imagemDireita[0]);
    }

    // Atualizar o item no banco de dados
    const itemAtualizado = await CardapioItem.findByIdAndUpdate(id, updateData, { new: true });
    res.json(itemAtualizado);
  } catch (error) {
    console.error('Erro ao atualizar item do cardápio:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar item' });
  }
});

app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    // Verificar se um arquivo foi enviado
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Nenhuma imagem enviada'
      });
    }

    // Upload para Cloudinary
    const imageUrl = await uploadToCloudinary(req.file);

    // Retornar a URL da imagem
    res.json({
      success: true,
      url: imageUrl,
      nome: req.body.imagemNome || 'imagem.jpg'
    });
  } catch (error) {
    console.error('Erro ao processar upload de imagem:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao processar imagem'
    });
  }
});

app.delete('/api/cardapio/item/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await CardapioItem.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover item do cardápio:', error);
    res.status(500).json({ success: false, message: 'Erro ao remover item' });
  }
});

app.patch('/api/cardapio/item/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar se o ID é válido
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }

    console.log(`Tentando atualizar item com ID: ${id}`);
    console.log('Dados recebidos para atualização:', req.body);

    const item = await CardapioItem.findByIdAndUpdate(id, req.body, { new: true });

    if (!item) {
      console.log(`Item com ID ${id} não encontrado`);
      return res.status(404).json({ success: false, message: 'Item não encontrado' });
    }

    console.log('Item atualizado com sucesso:', item);
    res.json(item);
  } catch (error) {
    console.error('Erro ao atualizar item do cardápio:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar item' });
  }
});

// === Formas de Pagamento ===
app.get('/api/pagamentos', async (req, res) => {
  try {
    const formasPagamento = await FormaPagamento.find();
    res.json(formasPagamento);
  } catch (error) {
    console.error('Erro ao buscar formas de pagamento:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar formas de pagamento' });
  }
});

app.post('/api/pagamentos', async (req, res) => {
  try {
    const { nome, requerTroco, ativo } = req.body;

    // Criar nova forma de pagamento
    const novaForma = await FormaPagamento.create({
      nome,
      requerTroco,
      ativo
    });

    res.json(novaForma);
  } catch (error) {
    console.error('Erro ao adicionar forma de pagamento:', error);
    res.status(500).json({ success: false, message: 'Erro ao adicionar forma de pagamento' });
  }
});

app.delete('/api/pagamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await FormaPagamento.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover forma de pagamento:', error);
    res.status(500).json({ success: false, message: 'Erro ao remover forma de pagamento' });
  }
});

app.patch('/api/pagamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const forma = await FormaPagamento.findByIdAndUpdate(id, req.body, { new: true });

    if (!forma) {
      return res.status(404).json({ success: false, message: 'Forma de pagamento não encontrada' });
    }

    res.json(forma);
  } catch (error) {
    console.error('Erro ao atualizar forma de pagamento:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar forma de pagamento' });
  }
});

// === Pedidos ===

app.post('/api/pedidos', async (req, res) => {
  try {
    const { telefone, itens, valorTotal, endereco, formaPagamento, status } = req.body;

    // Validar os dados recebidos
    if (!telefone || !itens || !valorTotal || !endereco || !formaPagamento || !status) {
      return res.status(400).json({ success: false, message: 'Dados do pedido incompletos' });
    }

    // Criar um novo pedido
    const novoPedido = await Pedido.create({
      telefone,
      itens,
      valorTotal,
      endereco,
      formaPagamento,
      status,
      data: new Date().toISOString()
    });

    res.json({ success: true, pedido: novoPedido });
  } catch (error) {
    console.error('Erro ao salvar pedido:', error);
    res.status(500).json({ success: false, message: 'Erro ao salvar pedido' });
  }
});

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

// === Conversas ===
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

// === Configuração de Área de Entrega ===
app.get('/api/delivery-config', async (req, res) => {
  try {
    const config = await DeliveryConfig.findOne();
    res.json(config || {});
  } catch (error) {
    console.error('Erro ao buscar configuração de entrega:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar configuração de entrega' });
  }
});

app.post('/api/delivery-config', async (req, res) => {
  try {
    const config = await DeliveryConfig.findOne();
    if (config) {
      // Atualizar configuração existente
      await DeliveryConfig.updateOne({}, req.body);
    } else {
      // Criar nova configuração
      await DeliveryConfig.create(req.body);
    }
    res.json({ success: true, message: 'Configurações de entrega salvas com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar configuração de entrega:', error);
    res.status(500).json({ success: false, message: 'Erro ao salvar configuração de entrega' });
  }
});

// === API Keys ===
app.get('/api/api-keys/google-maps', async (req, res) => {
  try {
    const apiKeys = await ApiKeys.findOne();
    res.json({ key: apiKeys ? apiKeys.googleMaps : '' });
  } catch (error) {
    console.error('Erro ao buscar chave da API:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar chave da API' });
  }
});

app.post('/api/api-keys/google-maps', async (req, res) => {
  try {
    const apiKeys = await ApiKeys.findOne();
    if (apiKeys) {
      // Atualizar chave existente
      await ApiKeys.updateOne({}, { googleMaps: req.body.key });
    } else {
      // Criar nova chave
      await ApiKeys.create({ googleMaps: req.body.key });
    }
    res.json({ success: true, message: 'Chave da API salva com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar chave da API:', error);
    res.status(500).json({ success: false, message: 'Erro ao salvar chave da API' });
  }
});

// === Endpoint para validação de endereço para teste direto ===
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

// === Endpoint para gerar áudio sob demanda ===
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

    console.log('Gerando áudio para texto:', audioText.substring(0, 50) + '...');

    // Verificar se o diretório de mídia existe
    const mediaDir = path.join(__dirname, 'public', 'media');
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
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

    try {
      // Inicializar OpenAI
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      console.log("Iniciando geração de áudio com API OpenAI...");

      const speech = await openai.audio.speech.create({
        model: "tts-1",
        voice: "ash",
        input: `\u200B ${cleanedText}`,
        response_format: "mp3"
      });

      console.log("Áudio gerado pela API OpenAI");

      // Obter o buffer do áudio gerado
      const arrayBuffer = await speech.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.log(`Buffer de áudio obtido: ${buffer.length} bytes`);

      if (buffer.length === 0) {
        throw new Error("API retornou um buffer vazio");
      }

      // Gerar um nome único para o arquivo
      const filename = `speech-${Date.now()}.mp3`;
      const audioPath = path.join(mediaDir, filename);

      // Salvar o arquivo
      fs.writeFileSync(audioPath, buffer);
      console.log(`Áudio salvo em: ${audioPath}`);

      // Verificar se o arquivo foi criado e tem conteúdo
      if (fs.existsSync(audioPath)) {
        const stats = fs.statSync(audioPath);
        console.log(`Verificação do arquivo: ${audioPath}, tamanho: ${stats.size} bytes`);

        if (stats.size > 0) {
          // Gerar URL pública
          const audioUrl = `/api/media/${filename}`;
          console.log('URL do áudio gerada:', audioUrl);

          return res.json({
            success: true,
            audio: audioUrl
          });
        } else {
          throw new Error("Arquivo de áudio criado, mas está vazio");
        }
      } else {
        throw new Error("Falha ao criar arquivo de áudio");
      }
    } catch (apiError) {
      console.error('Erro detalhado na API de áudio:', apiError);
      return res.status(500).json({
        success: false,
        error: 'Erro ao gerar áudio',
        message: apiError.message
      });
    }
  } catch (error) {
    console.error('Erro geral ao gerar áudio:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar áudio',
      message: error.message
    });
  }
});

// Adicione uma nova rota para gerar áudio específico de um pedido usando OpenAI
app.post('/api/pedido/:id/audio', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar o pedido
    const pedido = await Pedido.findById(id);
    if (!pedido) {
      return res.status(404).json({
        success: false,
        error: 'Pedido não encontrado'
      });
    }

    // Gerar texto de confirmação
    const confirmationText = gerarTextoConfirmacaoPedido({
      items: pedido.itens,
      endereco: pedido.endereco,
      pagamento: pedido.formaPagamento
    });

    // Verificar se o diretório de mídia existe
    const mediaDir = path.join(__dirname, 'public', 'media');
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    // Limpar o texto
    const cleanedText = confirmationText
      .replace(/<\/?[^>]+(>|$)/g, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .substring(0, 4000);

    // Verificar se temos a API KEY da OpenAI configurada
    if (!process.env.OPENAI_API_KEY) {
      console.error('API key da OpenAI não configurada');
      return res.status(500).json({
        success: false,
        error: 'Serviço de áudio não configurado'
      });
    }

    // Inicializar OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    console.log("Gerando áudio de pedido com OpenAI...");

    const speech = await openai.audio.speech.create({
      model: "tts-1",
      voice: "ash",
      input: `\u200B ${cleanedText}`,
      response_format: "mp3"
    });

    // Obter buffer
    const arrayBuffer = await speech.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error("API retornou um buffer vazio");
    }

    // Salvar arquivo
    const filename = `speech-${Date.now()}.mp3`;
    const audioPath = path.join(mediaDir, filename);
    fs.writeFileSync(audioPath, buffer);

    // Verificar arquivo
    if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0) {
      const audioUrl = `/api/media/${filename}`;
      return res.json({
        success: true,
        audio: audioUrl
      });
    } else {
      throw new Error("Falha ao criar arquivo de áudio");
    }
  } catch (error) {
    console.error('Erro ao gerar áudio do pedido:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar áudio do pedido',
      message: error.message
    });
  }
});

/**
 * Gera áudio a partir de texto
 * @param {String} text - Texto para converter em áudio
 * @returns {Promise<String>} - URL do áudio gerado ou null em caso de erro
 */
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

/**
 * Obtém o prompt do sistema a partir do banco de dados
 * @param {Object} botConfig - Configuração do bot
 * @param {Object} historia - História da pizzaria
 * @param {Array} cardapioItems - Itens do cardápio
 * @param {Array} formasPagamento - Formas de pagamento
 * @param {Number} currentState - Estado atual da conversa
 * @returns {Promise<String>} - Prompt do sistema completo
 */
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

/**
 * Formata os itens do cardápio para inclusão no prompt
 * @param {Array} items - Itens do cardápio
 * @returns {String} - Texto formatado do cardápio
 */
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

/**
 * Formata as formas de pagamento para inclusão no prompt
 * @param {Array} pagamentos - Formas de pagamento
 * @returns {String} - Texto formatado das formas de pagamento
 */
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

/**
 * Gera texto de confirmação do pedido a partir dos dados JSON
 * @param {Object} pedidoData - Dados do pedido
 * @returns {String} - Texto formatado de confirmação
 */
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

// === Endpoint para WhatsApp Bot ===
/**
 * Detecta se o usuário está pedindo uma ou mais imagens específicas
 * @param {string} message - Mensagem do usuário
 * @returns {string[]|null} - Retorna array de identificadores de imagem ou null
 */
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
    { name: 'porco & pinhão', id: 'pizza-salgada_pizza-porco-&-pinhao' },
    { name: 'porco e pinhão', id: 'pizza-salgada_pizza-porco-&-pinhao' },
    { name: 'porco e pinhao', id: 'pizza-salgada_pizza-porco-&-pinhao' },
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

  // NOVO: Verificar múltiplas pizzas mencionadas
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

/**
 * Função para sobrepor duas imagens de URLs (primeira sobre a segunda)
 * @param {string} baseImageUrl - URL da imagem de fundo (imagemDireita do sabor 2)
 * @param {string} overlayImageUrl - URL da imagem para sobrepor (imagemEsquerda do sabor 1)
 * @returns {Promise<string>} - Imagem base64 combinada
 */
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

/**
 * Download de mídia (áudio ou imagem)
 * @param {String} url - URL da mídia para download
 * @param {String} type - Tipo de mídia ('audio' ou 'image')
 * @returns {Promise<String|null>} - Caminho do arquivo salvo ou null em caso de erro
 */
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
    const mediaDir = path.join(__dirname, 'public', 'media');
    const extension = type === 'audio' ? 'mp3' : 'jpg';
    const filename = `${type}_${Date.now()}.${extension}`;
    const filePath = path.join(mediaDir, filename);

    // Garantir que o diretório existe
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    // Salvar arquivo
    fs.writeFileSync(filePath, response.data);
    console.log(`Arquivo salvo em: ${filePath}`);

    // Verificar o arquivo salvo
    const stats = fs.statSync(filePath);
    console.log(`Verificação do arquivo: ${filePath}, tamanho: ${stats.size} bytes`);

    if (stats.size === 0) {
      console.error('Arquivo salvo está vazio');
      return null;
    }

    return filePath;
  } catch (error) {
    console.error(`Erro detalhado ao fazer download de ${type}:`, error);
    if (error.response) {
      console.error(`Status: ${error.response.status}, Dados: ${typeof error.response.data}`);
    }
    return null;
  }
}

const tempPedidoData = new Map();

/**
 * Processa a resposta do modelo com base nas tags
 * @param {String} botResponse - Resposta original do modelo
 * @param {String} userMessage - Mensagem do usuário
 * @param {Object} conversa - Objeto da conversa
 * @param {Object} botConfig - Configuração do bot
 * @returns {Object} - Objeto com a resposta processada para o cliente
 */
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

        return; // Sair da função para evitar processamento adicional
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

            return; // Sair da função para evitar processamento adicional
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

/**
 * Extrai dados de pedido de uma resposta formatada
 * @param {string} text - Texto contendo possíveis tags JSON_FORMAT
 * @param {object} conversa - Objeto da conversa atual
 * @returns {object|null} - Dados do pedido extraídos ou null se não encontrados
 */
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

app.post('/api/message', async (req, res) => {
  try {
    const apiRequestStartTime = Date.now();
    console.log(`[${new Date().toISOString()}] API: Iniciando processamento para ${req.body.phone}`);

    console.log('Recebido no /api/message:', JSON.stringify(req.body));
    const { phone, message, isAudio, messageType, isFirstMessage, timestamp } = req.body;

    // Validação básica de entrada
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

    // Verificar se há pedido de reiniciar
    const isResetRequest = message.toLowerCase() === 'reiniciar' ||
      message.toLowerCase() === 'começar de novo' ||
      message.toLowerCase() === 'novo pedido';

    // Buscar a conversa mais recente para este telefone
    let conversa = await Conversa.findOne({ telefone: phone }).sort({ inicio: -1 });
    let novaConversaCriada = false;

    // LÓGICA DE CRIAÇÃO DE NOVA CONVERSA
    if (isResetRequest) {
      // Criar nova conversa em caso de reinício explícito
      conversa = new Conversa({
        telefone: phone,
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
          telefone: phone,
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
        telefone: phone,
        inicio: new Date().toISOString(),
        duracao: 0,
        state: 0,
        mensagens: []
      });
      await conversa.save();
      novaConversaCriada = true;
      console.log('Primeira conversa criada:', conversa._id);
    }

    // Se criou nova conversa e é pedido de reinício, retornar mensagem específica
    if (novaConversaCriada && isResetRequest) {
      try {
        // Adicionar a primeira mensagem na nova conversa
        conversa.mensagens.push({
          tipo: 'user',
          conteudo: message,
          data: timestamp || new Date().toISOString()
        });

        // Buscar a mensagem de boas-vindas COMPLETA do banco de dados
        const botConfig = await BotConfig.findOne().select('welcomeMessage');

        console.log('Buscando mensagem de boas-vindas para reinício...');

        // Verificar se temos uma mensagem de boas-vindas válida
        if (!botConfig || !botConfig.welcomeMessage) {
          console.error('Mensagem de boas-vindas não encontrada no banco de dados');
        } else {
          console.log('Mensagem de boas-vindas encontrada: ', botConfig.welcomeMessage.substring(0, 50) + '...');
        }

        // Usar a mensagem do banco ou uma mensagem padrão como fallback
        let welcomeMessage = (botConfig && botConfig.welcomeMessage)
          ? botConfig.welcomeMessage
          : "Olá! Sou o atendente virtual da pizzaria. Como posso ajudar?";

        // GARANTIR QUE A MENSAGEM TENHA A FORMATAÇÃO CORRETA
        // Verificar se a mensagem já tem as tags de formatação
        if (!welcomeMessage.includes('[TEXT_FORMAT]') && !welcomeMessage.includes('[/END]')) {
          console.log('Adicionando tags de formatação à mensagem de boas-vindas');
          welcomeMessage = `[TEXT_FORMAT]${welcomeMessage}[/END]`;
        }

        console.log('Usando mensagem formatada: ', welcomeMessage.substring(0, 50) + '...');

        // Adicionar a mensagem ao histórico da conversa
        conversa.mensagens.push({
          tipo: 'bot',
          conteudo: welcomeMessage,
          data: new Date().toISOString()
        });

        await conversa.save();
        console.log('Conversa salva com mensagem de boas-vindas');

        // Processar a mensagem de boas-vindas para extrair imagens, áudio, etc.
        const processedResponse = await processTaggedResponse(welcomeMessage, message, conversa, botConfig);

        // Verificar se o processamento gerou uma resposta de texto
        if (!processedResponse.text && welcomeMessage) {
          // Se não tiver texto na resposta processada, usar a mensagem original sem as tags
          processedResponse.text = welcomeMessage
            .replace('[TEXT_FORMAT]', '')
            .replace('[/END]', '')
            .trim();

          console.log('Adicionando texto à resposta final:', processedResponse.text.substring(0, 50) + '...');
        }

        return res.json({
          success: true,
          ...processedResponse,
          state: 0
        });
      } catch (error) {
        console.error('Erro ao buscar mensagem de boas-vindas:', error);

        // Fallback em caso de erro
        return res.json({
          success: true,
          text: "Olá! Seu atendimento foi reiniciado. Como posso ajudar?",
          state: 0
        });
      }
    }

    // Verificar se a mensagem contém um CEP
    const cepValidation = await detectAndValidateCEP(message);
    if (cepValidation) {
      console.log("Dados de CEP validados:", JSON.stringify(cepValidation));

      // Armazenar o CEP validado na conversa
      conversa.addressData = {
        formattedAddress: cepValidation.formattedAddress,
        components: cepValidation.components || { cep: cepValidation.formattedAddress.split(', ').pop() } // Garantir que components existe
      };

      // Log explícito após atualização
      console.log("Conversa atualizada com dados de endereço:", {
        formattedAddress: conversa.addressData.formattedAddress,
        components: JSON.stringify(conversa.addressData.components)
      });

      // Salvar imediatamente para garantir persistência
      await conversa.save();
      console.log("Endereço validado e armazenado na conversa");
      console.log(`[${new Date().toISOString()}] Iniciando carregamento de configurações para ${phone}`);
    }

    // Calcular duração da conversa
    const inicio = new Date(conversa.inicio);
    const agora = new Date();
    conversa.duracao = Math.round((agora - inicio) / 60000); // Em minutos

    // Verificar se é a primeira mensagem e buscar mensagem de boas-vindas
    // Na rota /api/message, procure este trecho:
    if (isFirstMessage) {
      try {
        // Adicione uma verificação de mensagens anteriores
        const mensagensAnteriores = await Conversa.countDocuments({
          telefone: phone,
          mensagens: { $elemMatch: { tipo: 'bot' } }
        });

        // Só enviar boas-vindas se não houver mensagens anteriores
        if (mensagensAnteriores === 0) {
          // Buscar configuração de boas-vindas do banco de dados
          const botConfig = await BotConfig.findOne();
          const welcomeMessageConfig = botConfig ? botConfig.welcomeMessage : "";

          // Se houver uma mensagem de boas-vindas configurada, enviá-la
          if (welcomeMessageConfig) {
            // Registrar no histórico
            conversa.mensagens.push({
              tipo: 'bot',
              conteudo: welcomeMessageConfig,
              data: new Date().toISOString()
            });

            await conversa.save();

            return res.json({
              success: true,
              text: welcomeMessageConfig,
              audio: null,
              image: null
            });
          }
        } else {
          console.log(`Ignorando mensagem de boas-vindas duplicada para ${phone}`);
        }
      } catch (welcomeError) {
        console.error('Erro ao processar mensagem de boas-vindas:', welcomeError);
        // Continuar com o fluxo normal se falhar
      }
    }

    // Se for tipo de mídia não suportada
    if (messageType && !['text', 'audio', 'ptt'].includes(messageType)) {
      try {
        // Buscar mensagem de erro para mídia não suportada
        const botConfig = await BotConfig.findOne();
        const unsupportedMediaMessage = botConfig ? botConfig.unsupportedMediaMessage : "Desculpe, só consigo processar mensagens de texto ou áudio.";

        // Registrar no histórico
        conversa.mensagens.push({
          tipo: 'user',
          conteudo: `[${messageType}]`,
          data: timestamp || new Date().toISOString()
        });

        // Detectar pedido completo
        const userMsg = message.toLowerCase();
        const hasPizzaType = userMsg.includes('tropicale') ||
          userMsg.includes('amazonas') ||
          userMsg.includes('napolitana') ||
          userMsg.includes('pizza');

        const hasPaymentMethod = userMsg.includes('pix') ||
          userMsg.includes('débito') ||
          userMsg.includes('crédito') ||
          userMsg.includes('dinheiro');

        const hasCEP = /\d{5}-?\d{3}/.test(message);
        const hasSize = userMsg.includes('pequena') ||
          userMsg.includes('média') ||
          userMsg.includes('grande') ||
          userMsg.includes('gigante');

        // Se parece ser um pedido completo
        if (hasPizzaType && (hasPaymentMethod || userMsg.includes('pagar')) && hasCEP) {
          console.log('Pedido completo em uma única mensagem detectado!');

          // Processar o CEP para obter endereço formatado
          const cepData = await detectAndValidateCEP(message);

          if (cepData) {
            // Extrair dados do pedido
            const pizzaName = userMsg.includes('tropicale') ? 'Tropicale' :
              userMsg.includes('amazonas') ? 'Amazonas' :
                userMsg.includes('napolitana') ? 'Napolitana Paulistana' : 'Tradicional';

            const pizzaSize = userMsg.includes('pequena') ? 'Pequena' :
              userMsg.includes('média') ? 'Média' :
                userMsg.includes('gigante') ? 'Gigante' :
                  userMsg.includes('grande') ? 'Grande' : 'Grande';

            const paymentMethod = userMsg.includes('pix') ? 'PIX' :
              userMsg.includes('débito') ? 'Cartão de Débito' :
                userMsg.includes('crédito') ? 'Cartão de Crédito' : 'Dinheiro';

            // Preços fixos de exemplo
            const itemPrice = pizzaSize === 'Grande' ? 89.90 :
              pizzaSize === 'Média' ? 69.90 :
                pizzaSize === 'Gigante' ? 99.90 : 49.90;

            // Verificar se precisa do número do endereço
            const numeroMatch = userMsg.match(/número\s+(\d+)/i) ||
              message.match(/,\s*(\d+)/) ||
              message.match(/n[º°]\s*(\d+)/i);

            if (!numeroMatch && cepData.components.street) {
              // Pedir o número do endereço
              const pedidoNumero = `Ótimo! Anotei seu pedido de Pizza ${pizzaName} ${pizzaSize} para pagar com ${paymentMethod}. Só preciso do número do seu endereço na ${cepData.components.street} para prosseguir com a entrega. Qual é o número?`;

              // Atualizar estado e registrar dados parciais do pedido
              conversa.state = 4;  // Estado de endereço
              conversa.addressData = {
                formattedAddress: cepData.formattedAddress,
                components: cepData.components
              };

              // Armazenar dados parciais do pedido para usar depois
              conversa.pedidoData = {
                items: [{
                  nome: `Pizza ${pizzaName} ${pizzaSize}`,
                  quantidade: 1,
                  preco: itemPrice
                }],
                pagamento: paymentMethod
              };

              conversa.mensagens.push({
                tipo: 'bot',
                conteudo: `[TEXT_FORMAT]${pedidoNumero}[/END]`,
                data: new Date().toISOString()
              });

              await conversa.save();

              return res.json({
                success: true,
                text: pedidoNumero,
                state: 4 // Estado de endereço
              });
            } else {
              // Se já tem o número (ou extraiu de alguma forma), mostrar resumo do pedido
              const numero = numeroMatch ? numeroMatch[1] : '';
              let enderecoCompleto = cepData.formattedAddress;

              // Adicionar número ao endereço formatado se não estiver presente
              if (numero && !enderecoCompleto.includes(`, ${numero},`)) {
                enderecoCompleto = cepData.components.street +
                  `, ${numero}, ` +
                  cepData.components.neighborhood +
                  `, ${cepData.components.city} - ${cepData.components.state}, ` +
                  cepData.components.cep;
              }

              // Preparar resumo do pedido
              const resumoPedido = `
[TEXT_FORMAT]Vou confirmar seu pedido:

*Pizza ${pizzaName} ${pizzaSize}* - R$ ${itemPrice.toFixed(2)}

*Endereço de entrega:* ${enderecoCompleto}
*Forma de pagamento:* ${paymentMethod}

*Total:* R$ ${itemPrice.toFixed(2)}

Está tudo correto? Responda SIM para confirmar ou informe se deseja modificar algo.[/END]
      `.trim();

              // Atualizar estado e dados do pedido
              conversa.state = 6;  // Estado de confirmação
              conversa.addressData = {
                formattedAddress: enderecoCompleto,
                components: cepData.components
              };

              conversa.pedidoData = {
                items: [{
                  nome: `Pizza ${pizzaName} ${pizzaSize}`,
                  quantidade: 1,
                  preco: itemPrice
                }],
                endereco: enderecoCompleto,
                pagamento: paymentMethod
              };

              conversa.mensagens.push({
                tipo: 'bot',
                conteudo: resumoPedido,
                data: new Date().toISOString()
              });

              await conversa.save();

              return res.json({
                success: true,
                text: resumoPedido.replace('[TEXT_FORMAT]', '').replace('[/END]', '').trim(),
                state: 6 // Estado de confirmação
              });
            }
          }
        }

        conversa.mensagens.push({
          tipo: 'bot',
          conteudo: unsupportedMediaMessage,
          data: new Date().toISOString()
        });

        await conversa.save();

        return res.json({
          success: true,
          text: unsupportedMediaMessage,
          audio: null,
          image: null
        });
      } catch (mediaError) {
        console.error('Erro ao processar mídia não suportada:', mediaError);
        return res.status(500).json({
          success: false,
          error: 'Erro ao processar mídia',
          text: 'Desculpe, ocorreu um erro ao processar sua mensagem.'
        });
      }
    }

    // Verificar se é uma pergunta sobre área de entrega
    const isDeliveryQuery = message.toLowerCase().includes('entrega') &&
      (message.toLowerCase().includes('?') ||
        message.toLowerCase().includes('vocês') ||
        message.toLowerCase().includes('voces'));

    if (isDeliveryQuery) {
      // Extrair o possível local da consulta
      const locationMatch = message.match(/(?:em|na|no)\s+([^?.,]+)/i);
      if (locationMatch && locationMatch[1]) {
        const location = locationMatch[1].trim();
        console.log(`Detectou consulta sobre entrega em: ${location}`);

        // Validar como consulta de área, não endereço completo
        const validationResult = await validateAddress(location, true);

        // Adicionar mensagem do usuário ao histórico
        conversa.mensagens.push({
          tipo: 'user',
          conteudo: isAudio ? `[Áudio]: ${message}` : message,
          data: timestamp || new Date().toISOString()
        });

        // Adicionar resposta do bot ao histórico
        conversa.mensagens.push({
          tipo: 'bot',
          conteudo: validationResult.message,
          data: new Date().toISOString()
        });

        await conversa.save();

        return res.json({
          success: true,
          text: validationResult.message,
          audio: null,
          image: null
        });
      }
    }

    // Verificar se a mensagem parece ser um endereço e estamos no estado correto do pedido
    let isAddressValidationNeeded = false;

    // Se estamos no estado de informar endereço (estado 4 conforme o documento)
    if (conversa.state === 4) {
      // Verificar se parece com um endereço (contém nome de rua, avenida, etc.)
      const parece_endereco = /\b(r\.|rua|av\.|avenida|alameda|al\.|travessa|estrada)\b/i.test(message);
      isAddressValidationNeeded = parece_endereco;
    }

    // Se for potencialmente um endereço e estamos no estado correto, validar
    let validatedAddress = null;
    if (isAddressValidationNeeded && message && message.length > 10) {
      try {
        validatedAddress = await validateAddress(message, false); // false = não é apenas consulta

        // Se o endereço não for válido, retornar feedback imediatamente
        if (!validatedAddress.valid) {
          // Adicionar mensagem do usuário ao histórico
          conversa.mensagens.push({
            tipo: 'user',
            conteudo: isAudio ? `[Áudio]: ${message}` : message,
            data: timestamp || new Date().toISOString()
          });

          // Adicionar resposta do bot ao histórico
          conversa.mensagens.push({
            tipo: 'bot',
            conteudo: validatedAddress.message,
            data: new Date().toISOString()
          });

          await conversa.save();

          // Não avançar o estado se o endereço for inválido
          return res.json({
            success: true,
            text: validatedAddress.message,
            audio: null,
            image: null
          });
        }

        // Se o endereço for válido, armazenar na conversa
        if (validatedAddress.valid && validatedAddress.formattedAddress) {
          conversa.addressData = {
            formattedAddress: validatedAddress.formattedAddress,
            components: validatedAddress.components
          };

          // Adicionar informação do endereço validado à mensagem
          message = `${message} [Endereço validado: ${validatedAddress.formattedAddress}]`;
        }
      } catch (addressError) {
        console.error('Erro ao validar endereço:', addressError);
      }
    }

    // Adicionar mensagem à conversa
    conversa.mensagens.push({
      tipo: 'user',
      conteudo: isAudio ? `[Áudio]: ${message}` : message,
      data: timestamp || new Date().toISOString()
    });

    // Buscar configurações básicas do bot primeiro
    let botConfig;
    try {
      console.time('get_cached_data');
      const cachedData = await getCachedData();
      botConfig = cachedData.botConfig;
      console.timeEnd('get_cached_data');
      console.log('Configuração básica do bot carregada do cache');
    } catch (configError) {
      console.error('Erro ao carregar configuração do bot:', configError);
      botConfig = null;
    }


    // Verificação forçada para estado de endereço (sem número)
    // Na função que processa as mensagens, onde verifica o estado

    // Verificação para não mencionar troco antes de ter a forma de pagamento
    // Na parte onde processa a mensagem no estado 5 (pagamento)
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
          botResponse = `[TEXT_FORMAT]${paymentMsg}[/END]`;

          conversa.mensagens.push({
            tipo: 'bot',
            conteudo: botResponse,
            data: new Date().toISOString()
          });

          await conversa.save();

          return res.json({
            success: true,
            text: paymentMsg
          });
        }
        // Se não for a primeira, verificar se precisa especificar tipo de cartão
        else {
          // Verificar se falta especificação de tipo de cartão
          const temCredito = message.toLowerCase().includes('credito') ||
            message.toLowerCase().includes('crédito');
          const temDebito = message.toLowerCase().includes('debito') ||
            message.toLowerCase().includes('débito');

          // Se não especificou crédito nem débito, pedir clarificação
          if (!temCredito && !temDebito) {
            // Resposta forçada pedindo para especificar
            const cartaoMsg = "Por favor, especifique melhor a forma de pagamento. Aceitamos VR, PIX, dinheiro (com a possibilidade de troco) e, se desejar, também consigo finalizar o pedido com cartão de crédito ou débito.";

            conversa.mensagens.push({
              tipo: 'bot',
              conteudo: `[TEXT_FORMAT]${cartaoMsg}[/END]`,
              data: new Date().toISOString()
            });

            await conversa.save();

            // Não avançar o estado até especificar o tipo
            return res.json({
              success: true,
              text: cartaoMsg
            });
          }
        }
      }
    }

    // Quando o usuário finaliza o pedido (estado 6->7)
    if (conversa.state === 6 && (message.toLowerCase().includes('sim') ||
      message.toLowerCase().includes('correto') ||
      message.toLowerCase().includes('ok'))) {

      // Confirmar o pedido definitivamente
      console.log('Confirmação de pedido detectada');
      console.log('Estado atual da conversa:', conversa.state);
      console.log('Conteúdo da mensagem:', message);

      // Verificar se temos dados do pedido
      if (!conversa.pedidoData) {
        console.error('Dados do pedido ausentes na confirmação');
        return res.json({
          success: true,
          text: "Desculpe, houve um problema com seu pedido. Poderia começar novamente?",
          state: 0 // Voltar ao estado inicial
        });
      }

      try {
        // Registrar o pedido no banco de dados
        const pedidoData = conversa.pedidoData;
        console.log('Dados do pedido encontrados:', JSON.stringify(pedidoData));

        // CORREÇÃO: Garantir que o endereço tenha número
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

        // ADICIONE ESTE LOG antes de retornar a resposta
        console.log("ENVIANDO CONFIRMAÇÃO PARA O CLIENTE:", {
          confirmacaoTexto: confirmacao.substring(0, 100) + "...",
          formatado: confirmacao.replace('[TEXT_FORMAT]', '').replace('[/END]', '').trim().substring(0, 100) + "..."
        });

        // Verificar se temos o objeto de resposta gerado pelo LLM
        const botResponse = await processTaggedResponse(confirmacao, message, conversa, null);
        console.log("RESPOSTA PROCESSADA:", {
          temTexto: !!botResponse.text,
          textoLength: botResponse.text ? botResponse.text.length : 0,
          temImagem: !!botResponse.image,
          temAudio: !!botResponse.audio,
          state: botResponse.state
        });

        // Adicione verificações de formatação
        if (!botResponse.text || botResponse.text.trim().length === 0) {
          console.warn("ALERTA: Texto de confirmação vazio após processamento!");

          // Garantir que temos texto para enviar
          botResponse.text = confirmacao.replace('[TEXT_FORMAT]', '').replace('[/END]', '').trim();
        }

        return res.json(botResponse);

      } catch (error) {
        console.error('Erro ao confirmar pedido:', error);
        return res.json({
          success: true,
          text: "Desculpe, ocorreu um erro ao finalizar seu pedido. Por favor, tente novamente.",
          state: 6 // Manter no estado de confirmação
        });
      }
    }

    // AQUI: Verificar se o usuário está pedindo uma imagem específica
    const imageRequestIds = detectImageRequest(message);

    // Se detectou pedido de imagem, responder diretamente
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
      const processedResponse = await processTaggedResponse(responseText, message, conversa, botConfig);

      console.log('Enviando resposta direta com imagens ao cliente...');
      console.log(`Total de imagens: ${processedResponse.allImages ? processedResponse.allImages.length : 0}`);
      return res.json(processedResponse);
    }

    // Buscar configurações completas para construir o contexto do LLM
    let historia, cardapioItems, formasPagamento;
    try {
      console.time('get_additional_cached_data');
      const cachedData = await getCachedData();
      historia = cachedData.historia;
      formasPagamento = cachedData.formasPagamento;
      cardapioItems = cachedData.cardapioItems;
      console.timeEnd('get_additional_cached_data');
      console.log('Configurações adicionais carregadas com sucesso');
    } catch (configError) {
      console.error('Erro ao carregar configurações adicionais:', configError);
      historia = null;
      cardapioItems = [];
      formasPagamento = [];
    }

    // Histórico de mensagens (até 2 últimas)
    const ultimas5Mensagens = conversa.mensagens.slice(-10);

    // Preparar mensagens para o modelo
    const mensagens = [
      // O system prompt será carregado do banco de dados
      {
        role: 'system',
        content: await getSystemPromptFromDatabase(botConfig, historia, cardapioItems, formasPagamento, conversa.state, conversa)
      }
    ];

    console.log(`[${new Date().toISOString()}] Prompt processado para ${phone}`);
    // Adicionar histórico de conversa
    ultimas5Mensagens.forEach(msg => {
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

    // MODIFICAÇÃO CHAVE: Adicionar lembrete explícito sobre o formato esperado
    // Pegamos a última mensagem do usuário e adicionamos um lembrete claro
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
[/END]

Exemplo de resposta com imagem: 
[TEXT_FORMAT]Claro! Aqui está a imagem da nossa deliciosa pizza Amazonas.[/END]
[IMAGE_FORMAT]pizza-salgada_pizza-amazonas[/END]`;
      }
    }

    let botResponse;

    try {
      console.log(`[${new Date().toISOString()}] Iniciando chamada à API OpenAI para ${phone}`);
      const openaiStartTime = Date.now();

      console.log('Enviando requisição para LLM...');

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
        console.log(`[${new Date().toISOString()}] Resposta do OpenAI recebida para ${phone} em ${openaiEndTime - openaiStartTime}ms`);

        console.log('Resposta recebida do LLM');

        // Resto do código continua normalmente...
      } catch (openaiError) {
        console.error('Erro na API da OpenAI:', openaiError);
        botResponse = "[TEXT_FORMAT]Desculpe, estou enfrentando alguns problemas técnicos no momento. Poderia tentar novamente em instantes?[/END]";
      }
      console.log('Resposta recebida do LLM');

      // Verificar se a resposta tem JSON de pedido
      // Quando encontrar JSON_FORMAT, apenas armazene temporariamente, não salve no banco
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

              // NÃO SALVE NO BANCO AQUI! Apenas mostre resumo para confirmação
            }
          }
        } catch (error) {
          console.error('Erro ao processar pedido:', error);
        }
      }

      // Verificar se o LLM está solicitando informações adicionais
      const needsHistory = botResponse.includes('[REQUEST_HISTORY]') || botResponse.includes('[/REQUEST_HISTORY]') || botResponse.includes('[\REQUEST_HISTORY]');
      const needsMenu = botResponse.includes('[REQUEST_MENU]') || botResponse.includes('[/REQUEST_MENU]') || botResponse.includes('[\REQUEST_MENU]');
      const needsPayment = botResponse.includes('[REQUEST_PAYMENT]') || botResponse.includes('[/REQUEST_PAYMENT]') || botResponse.includes('[\REQUEST_PAYMENT]');

      // Se precisar de alguma informação adicional, fazer nova consulta com mais contexto
      if (needsHistory || needsMenu || needsPayment) {
        console.log('LLM sinalizou necessidade de informações adicionais');

        // Remover as tags de solicitação para não confundir o usuário
        botResponse = botResponse
          .replace('[REQUEST_HISTORY]', '').replace('[/REQUEST_HISTORY]', '').replace('[\REQUEST_HISTORY]', '')
          .replace('[REQUEST_MENU]', '').replace('[/REQUEST_MENU]', '').replace('[\REQUEST_MENU]', '')
          .replace('[REQUEST_PAYMENT]', '').replace('[/REQUEST_PAYMENT]', '').replace('[\REQUEST_PAYMENT]', '')
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

            // Fazer nova consulta à API sem o parâmetro timeout 
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
            // Use a estrutura correta para acessar o conteúdo
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

          return res.json({
            success: true,
            text: addressRequestMsg,
            state: 4
          });
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
    console.log(`[${new Date().toISOString()}] API: Processamento completo para ${phone} em ${totalTime}ms`);
    if (totalTime > 5000) {
      console.warn(`⚠️ Processamento lento detectado (${totalTime}ms) para ${phone}`);
    }

    // Enviar a resposta
    console.log('Enviando resposta ao cliente...');
    return res.json(responseObj);

  } catch (error) {
    // Tratamento de erro global
    console.error('ERRO CRÍTICO no processamento da mensagem:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      text: "Desculpe, ocorreu um erro ao processar sua mensagem."
    });
  }
});

/**
 * Registra o pedido confirmado no banco de dados
 * @param {Object} pedidoData - Dados do pedido em formato JSON
 * @param {Object} conversa - Objeto da conversa
 * @returns {Promise<Object>} - Retorna o objeto do pedido salvo
 */
async function registrarPedidoConfirmado(pedidoData, conversa) {
  console.log('Iniciando registro de pedido');

  try {
    // Validações básicas dos dados
    if (!pedidoData) {
      throw new Error('Dados do pedido ausentes');
    }

    if (!Array.isArray(pedidoData.items) || pedidoData.items.length === 0) {
      throw new Error('Itens do pedido inválidos ou vazios');
    }

    if (!pedidoData.endereco) {
      throw new Error('Endereço não informado');
    }

    if (!pedidoData.pagamento) {
      throw new Error('Forma de pagamento não informada');
    }

    // Usar o endereço mais completo disponível
    let enderecoCompleto = pedidoData.endereco;

    // Verificar se o endereço do pedido tem número
    if (!enderecoCompleto.match(/\d+/)) {
      // Se não tem número no endereço do pedido, verificar se temos número no userMsg
      const numeroMatch = userMsg.match(/número\s+(\d+)/i) ||
        userMsg.match(/,\s*(\d+)/) ||
        userMsg.match(/n[º°]\s*(\d+)/i);

      if (numeroMatch && conversa.addressData && conversa.addressData.formattedAddress) {
        // Construir endereço completo com o número
        const numero = numeroMatch[1];
        enderecoCompleto = conversa.addressData.components.street +
          `, ${numero}, ` +
          conversa.addressData.components.neighborhood +
          `, ${conversa.addressData.components.city} - ${conversa.addressData.components.state}, ` +
          conversa.addressData.components.cep;
      }
    }
    if (conversa.addressData && conversa.addressData.formattedAddress) {
      // Priorizar endereço obtido via CEP
      enderecoCompleto = conversa.addressData.formattedAddress;
      console.log('Usando endereço validado via CEP:', enderecoCompleto);
    }

    // Calcular valor total
    let valorTotal = 0;
    pedidoData.items.forEach(item => {
      const quantidade = item.quantidade || 1;
      const preco = parseFloat(item.preco);
      if (isNaN(preco)) {
        throw new Error(`Preço inválido para o item ${item.nome}`);
      }
      valorTotal += preco * quantidade;
    });

    // Criar novo pedido
    console.log('Criando novo pedido');
    const novoPedido = new Pedido({
      telefone: conversa.telefone,
      itens: pedidoData.items.map(item => ({
        nome: item.nome,
        quantidade: item.quantidade || 1,
        preco: parseFloat(item.preco)
      })),
      valorTotal: valorTotal,
      endereco: enderecoCompleto,
      formaPagamento: pedidoData.pagamento,
      status: 'Confirmado',
      data: new Date().toISOString()
    });

    const pedidoSalvo = await novoPedido.save();
    console.log(`Novo pedido criado com sucesso: ${pedidoSalvo._id}`);
    return pedidoSalvo;
  } catch (error) {
    console.error('Erro no registro de pedido:', error);
    throw error;
  }
}

// Modificação na função gerarTextoConfirmacaoPedido para usar o endereço mais completo
// Se possível, manter o restante da função como está

function gerarTextoConfirmacaoPedido(pedidoData) {
  try {
    if (!pedidoData || !pedidoData.items || !pedidoData.endereco || !pedidoData.pagamento) {
      return "Pedido confirmado! Obrigado pela preferência.";
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
    texto += `*Endereço de Entrega:* ${pedidoData.endereco}\n`;
    texto += `*Forma de Pagamento:* ${pedidoData.pagamento}\n\n`;
    texto += "Seu pedido será entregue em aproximadamente 50 minutos. Obrigado pela preferência! 🍕";

    return texto;
  } catch (error) {
    console.error('Erro ao gerar texto de confirmação:', error);
    return "Pedido confirmado! Obrigado pela preferência.";
  }
}

// Função para verificar se deve avançar o estado
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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});