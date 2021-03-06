"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = _default;

var _stream = require("stream");

var _fs = _interopRequireDefault(require("fs"));

var _path = _interopRequireDefault(require("path"));

var _crypto = _interopRequireDefault(require("crypto"));

var _svgicons2svgfont = _interopRequireDefault(require("svgicons2svgfont"));

var _cosmiconfig = _interopRequireDefault(require("cosmiconfig"));

var _pLimit = _interopRequireDefault(require("p-limit"));

var _metadata = _interopRequireDefault(require("svgicons2svgfont/src/metadata"));

var _filesorter = _interopRequireDefault(require("svgicons2svgfont/src/filesorter"));

var _globby = _interopRequireDefault(require("globby"));

var _deepmerge = _interopRequireDefault(require("deepmerge"));

var _nunjucks = _interopRequireDefault(require("nunjucks"));

var _svg2ttf = _interopRequireDefault(require("svg2ttf"));

var _ttf2eot = _interopRequireDefault(require("ttf2eot"));

var _ttf2woff = _interopRequireDefault(require("ttf2woff"));

var _wawoff = _interopRequireDefault(require("wawoff2"));

var _xml2js = _interopRequireDefault(require("xml2js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

async function buildConfig(options) {
  let searchPath = process.cwd();
  let configPath = null;

  if (options.configFile) {
    searchPath = null;
    configPath = _path.default.resolve(process.cwd(), options.configFile);
  }

  const configExplorer = (0, _cosmiconfig.default)("webfont");
  const config = await (configPath ? configExplorer.load(configPath) : configExplorer.search(searchPath));

  if (!config) {
    return {};
  }

  return config;
}

function getGlyphsData(files, options) {
  const metadataProvider = options.metadataProvider || (0, _metadata.default)({
    prependUnicode: options.prependUnicode,
    startUnicode: options.startUnicode
  });
  const xmlParser = new _xml2js.default.Parser();
  const throttle = (0, _pLimit.default)(options.maxConcurrency);
  return Promise.all(files.map(srcPath => throttle(() => new Promise((resolve, reject) => {
    const glyph = _fs.default.createReadStream(srcPath);

    let glyphContents = "";
    return glyph.on("error", glyphError => reject(glyphError)).on("data", data => {
      glyphContents += data.toString();
    }).on("end", () => {
      // Maybe bug in xml2js
      if (glyphContents.length === 0) {
        return reject(new Error(`Empty file ${srcPath}`));
      }

      return xmlParser.parseString(glyphContents, error => {
        if (error) {
          return reject(error);
        }

        const glyphData = {
          contents: glyphContents,
          srcPath
        };
        return resolve(glyphData);
      });
    });
  })))).then(glyphsData => {
    const sortedGlyphsData = options.sort ? glyphsData.sort((fileA, fileB) => (0, _filesorter.default)(fileA.srcPath, fileB.srcPath)) : glyphsData;
    return Promise.all(sortedGlyphsData.map(glyphData => new Promise((resolve, reject) => {
      metadataProvider(glyphData.srcPath, (error, metadata) => {
        if (error) {
          return reject(error);
        }

        glyphData.metadata = metadata;
        return resolve(glyphData);
      });
    })));
  });
}

function toSvg(glyphsData, options) {
  let result = "";
  return new Promise((resolve, reject) => {
    const fontStream = new _svgicons2svgfont.default({
      ascent: options.ascent,
      centerHorizontally: options.centerHorizontally,
      descent: options.descent,
      fixedWidth: options.fixedWidth,
      fontHeight: options.fontHeight,
      fontId: options.fontId,
      fontName: options.fontName,
      fontStyle: options.fontStyle,
      fontWeight: options.fontWeight,
      // eslint-disable-next-line no-console, no-empty-function
      log: options.verbose ? console.log.bind(console) : () => {},
      metadata: options.metadata,
      normalize: options.normalize,
      round: options.round
    }).on("finish", () => resolve(result)).on("data", data => {
      result += data;
    }).on("error", error => reject(error));
    glyphsData.forEach(glyphData => {
      const glyphStream = new _stream.Readable();
      glyphStream.push(glyphData.contents);
      glyphStream.push(null);
      glyphStream.metadata = glyphData.metadata;
      fontStream.write(glyphStream);
    });
    fontStream.end();
  });
}

function toTtf(buffer, options) {
  return Buffer.from((0, _svg2ttf.default)(buffer, options).buffer);
}

function toEot(buffer) {
  return Buffer.from((0, _ttf2eot.default)(buffer).buffer);
}

function toWoff(buffer, options) {
  return Buffer.from((0, _ttf2woff.default)(buffer, options).buffer);
}

function toWoff2(buffer) {
  return _wawoff.default.compress(buffer);
}

async function _default(initialOptions) {
  if (!initialOptions || !initialOptions.files) {
    throw new Error("You must pass webfont a `files` glob");
  }

  let options = Object.assign({}, {
    ascent: undefined,
    // eslint-disable-line no-undefined
    centerHorizontally: false,
    descent: 0,
    fixedWidth: false,
    fontHeight: null,
    fontId: null,
    fontName: "webfont",
    fontStyle: "",
    fontWeight: "",
    formats: ["svg", "ttf", "eot", "woff", "woff2"],
    formatsOptions: {
      ttf: {
        copyright: null,
        ts: null,
        version: null
      }
    },
    glyphTransformFn: null,
    // Maybe allow setup from CLI
    // This is usually less than file read maximums while staying performance
    maxConcurrency: 100,
    metadata: null,
    metadataProvider: null,
    normalize: false,
    prependUnicode: false,
    round: 10e12,
    sort: true,
    startUnicode: 0xea01,
    template: null,
    templateClassName: null,
    templateFontName: null,
    templateFontPath: "./",
    verbose: false
  }, initialOptions);
  const config = await buildConfig({
    configFile: options.configFile
  });

  if (Object.keys(config).length > 0) {
    options = (0, _deepmerge.default)(options, config.config);
    options.filePath = config.filepath;
  }

  const foundFiles = await (0, _globby.default)([].concat(options.files));
  const filteredFiles = foundFiles.filter(foundFile => _path.default.extname(foundFile) === ".svg");

  if (filteredFiles.length === 0) {
    throw new Error("Files glob patterns specified did not match any files");
  }

  const result = {};
  result.glyphsData = await getGlyphsData(filteredFiles, options);
  result.svg = await toSvg(result.glyphsData, options);
  result.ttf = toTtf(result.svg, options.formatsOptions && options.formatsOptions.ttf ? options.formatsOptions.ttf : {});
  result.hash = _crypto.default.createHash("md5").update(result.svg).digest("hex");

  if (options.formats.includes("eot")) {
    result.eot = toEot(result.ttf);
  }

  if (options.formats.includes("woff")) {
    result.woff = toWoff(result.ttf, {
      metadata: options.metadata
    });
  }

  if (options.formats.includes("woff2")) {
    result.woff2 = await toWoff2(result.ttf);
  }

  if (options.template) {
    const templateDirectory = _path.default.resolve(__dirname, "../templates");

    const buildInTemplates = {
      css: {
        path: _path.default.join(templateDirectory, "template.css.njk")
      },
      html: {
        path: _path.default.join(templateDirectory, "template.html.njk")
      },
      scss: {
        path: _path.default.join(templateDirectory, "template.scss.njk")
      }
    };
    let templateFilePath = null;

    if (Object.keys(buildInTemplates).includes(options.template)) {
      result.usedBuildInTemplate = true;

      _nunjucks.default.configure(_path.default.resolve(__dirname, "../"));

      templateFilePath = `${templateDirectory}/template.${options.template}.njk`;
    } else {
      const resolvedTemplateFilePath = _path.default.resolve(options.template);

      _nunjucks.default.configure(_path.default.dirname(resolvedTemplateFilePath));

      templateFilePath = _path.default.resolve(resolvedTemplateFilePath);
    }

    const hashOption = options.addHashInFontUrl ? {
      hash: result.hash
    } : {};

    const nunjucksOptions = _deepmerge.default.all([{
      glyphs: result.glyphsData.map(glyphData => {
        if (typeof options.glyphTransformFn === "function") {
          glyphData.metadata = options.glyphTransformFn(glyphData.metadata);
        }

        return glyphData.metadata;
      })
    }, options, {
      className: options.templateClassName || options.fontName,
      fontName: options.templateFontName || options.fontName,
      fontPath: options.templateFontPath.replace(/\/?$/, "/")
    }, hashOption]);

    result.template = _nunjucks.default.render(templateFilePath, nunjucksOptions);
  }

  if (!options.formats.includes("svg")) {
    delete result.svg;
  }

  if (!options.formats.includes("ttf")) {
    delete result.ttf;
  }

  result.config = options;
  return result;
}