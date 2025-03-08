const mongoose = require('mongoose');

// Schema para configuração do bot
const BotConfigSchema = new mongoose.Schema({
    nome: String,
    descricao: String,
    personalidade: String,
    procedimento: String,
    regras: String,
    welcomeMessage: String,
    unsupportedMediaMessage: String,
    menuImage: String,
    menuImageCaption: String,
    confirmationImage: String,
    confirmationImageCaption: String,
    // Novos campos para o sistema de tags
    systemPrompt: {
        type: String,
        default: ''
    },
    formatInstruction: {
        type: String,
        default: '[TEXT_FORMAT], [VOICE_FORMAT], [IMAGE_FORMAT] ou [JSON_FORMAT] seguido de [/END]'
    },
    interactionRules: {
        type: mongoose.Schema.Types.Mixed,
        default: {
            visualRequests: {
                keywords: [],
                commandFormat: "SEND_IMAGE(identificador)",
                defaultResponse: "Desculpe, não entendi o pedido de imagem."
            },
            audioRequests: {
                keywords: [],
                commandFormat: "SEND_AUDIO(texto)",
                defaultResponse: "Desculpe, não entendi o pedido de áudio."
            },
            halfHalfPizzaRequests: {
                commandFormat: "SEND_MEIA_META_IMAGE(pizza1,pizza2)",
                defaultResponse: "Desculpe, não entendi o pedido de pizza meio a meio."
            }
        }
    }
});

// Schema para história da pizzaria
const PizzariaHistoriaSchema = new mongoose.Schema({
    titulo: String,
    conteudo: String,
    imagem: String
});

// Schema para itens do cardápio
const CardapioItemSchema = new mongoose.Schema({
    nome: {
      type: String,
      required: true,
      trim: true
    },
    descricao: {
      type: String,
      trim: true
    },
    inspiracao: {
      type: String,
      trim: true
    },
    categoria: {
      type: mongoose.Schema.Types.Mixed, // Aceita string ou ObjectId
      required: true
    },
    preco: {
      type: Number,
      required: true,
      min: 0
    },
    imagemGeral: String,
    imagemEsquerda: String,
    imagemDireita: String,
    disponivel: {
      type: Boolean,
      default: true
    },
    identificador: {
      type: String,
      unique: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  });

// Schema para categorias
const CategoriaSchema = new mongoose.Schema({
    nome: String,
    ordem: {
        type: Number,
        default: 0
    },
    ativo: {
        type: Boolean,
        default: true
    }
});

// Schema para formas de pagamento
const FormaPagamentoSchema = new mongoose.Schema({
    nome: String,
    requerTroco: Boolean,
    ativo: Boolean
});

// Schema para conversas
const MensagemSchema = new mongoose.Schema({
    tipo: String, // 'user' ou 'bot'
    conteudo: String,
    data: { type: Date, default: Date.now }
});

const ConversaSchema = new mongoose.Schema({
    telefone: String,
    nomeContato: String, 
    inicio: { type: Date, default: Date.now },
    duracao: Number,
    state: { type: Number, default: 0 },
    mensagens: [MensagemSchema],
    addressData: {
        formattedAddress: String,
        components: mongoose.Schema.Types.Mixed
    },
    // Novo campo para armazenar dados do pedido processados
    pedidoData: mongoose.Schema.Types.Mixed,
    // Referência ao pedido finalizado
    pedidoId: mongoose.Schema.Types.ObjectId
});

// Schema para pedidos
const ItemPedidoSchema = new mongoose.Schema({
    nome: String,
    quantidade: Number,
    preco: Number
});

const PedidoSchema = new mongoose.Schema({
    telefone: String,
    data: { type: Date, default: Date.now },
    status: String,
    valorTotal: Number,
    endereco: String,
    formaPagamento: String,
    itens: [ItemPedidoSchema]
});

// Schema para configuração de área de entrega
const AreaEntregaSchema = new mongoose.Schema({
    city: String,
    state: String,
    active: Boolean
});

const DeliveryConfigSchema = new mongoose.Schema({
    enabled: Boolean,
    areas: [AreaEntregaSchema],
    restrictions: {
        limitToSpecificAreas: Boolean,
        maxDistance: Number,
        additionalFeePerKm: Number
    },
    messages: {
        outsideAreaMessage: String,
        partialAddressMessage: String
    }
});

// Schema para chaves de API
const ApiKeysSchema = new mongoose.Schema({
    googleMaps: String
});

// Modelos
const BotConfig = mongoose.model('BotConfig', BotConfigSchema);
const PizzariaHistoria = mongoose.model('PizzariaHistoria', PizzariaHistoriaSchema);
const CardapioItem = mongoose.model('CardapioItem', CardapioItemSchema);
const Categoria = mongoose.model('Categoria', CategoriaSchema);
const FormaPagamento = mongoose.model('FormaPagamento', FormaPagamentoSchema);
const Conversa = mongoose.model('Conversa', ConversaSchema);
const Pedido = mongoose.model('Pedido', PedidoSchema);
const DeliveryConfig = mongoose.model('DeliveryConfig', DeliveryConfigSchema);
const ApiKeys = mongoose.model('ApiKeys', ApiKeysSchema);

module.exports = {
    BotConfig,
    PizzariaHistoria,
    CardapioItem,
    Categoria,
    FormaPagamento,
    Conversa,
    Pedido,
    DeliveryConfig,
    ApiKeys
};