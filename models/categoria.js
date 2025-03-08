const mongoose = require('mongoose');

const categoriaSchema = new mongoose.Schema({
  nome: {
    type: String,
    required: true,
    unique: true, // Ensure category names are unique
    trim: true
  },
  ordem: {
    type: Number,
    default: 999 // Default to a high number for new categories
  },
  ativo: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Categoria', categoriaSchema);