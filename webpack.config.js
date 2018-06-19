const path = require('path');

function resolve(dir) {
  return path.join(__dirname, dir);
}

const webpackConfig = {
  entry: './src/camera-controls.js',
  output: {
    path: `${__dirname}/lib`,
    filename: 'index.js',
    publicPath: '/',
    library: 'cognite',
    libraryTarget: 'umd',
  },
  target: 'web',
  resolve: {
    extensions: ['.js', '.json'],
    modules: ['node_modules'],
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: 'babel-loader',
        include: [resolve('src'), resolve('test')],
      },
    ],
  },
};

module.exports = webpackConfig;
