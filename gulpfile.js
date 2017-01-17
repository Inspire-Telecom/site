'use strict';
// ## Globals
const gulp = require('gulp');
const gutil = require('gulp-util');
const autoprefixer = require('gulp-autoprefixer');
const babel = require('gulp-babel');
const changed = require('gulp-changed');
const concat = require('gulp-concat');
const cssnano = require('gulp-cssnano');
const eslint = require('gulp-eslint');
const favicons = require('gulp-favicons');
const flatten = require('gulp-flatten');
const gulpif = require('gulp-if');
const imagemin = require('gulp-imagemin');
const lazypipe = require('lazypipe');
//const less = require('gulp-less');
const merge = require('merge-stream');
const plumber = require('gulp-plumber');
const rev = require('gulp-rev');
const runSequence = require('run-sequence');
const sass = require('gulp-sass');
const sassLint = require('gulp-sass-lint');
const sourcemaps = require('gulp-sourcemaps');
const svgSprite = require('gulp-svg-sprite');
const uglify = require('gulp-uglify');

const argv = require('minimist')(process.argv.slice(2));
const browserSync = require('browser-sync').create();

// See https://github.com/austinpray/asset-builder
var manifest = require('asset-builder')('./assets/manifest.json');

// `path` - Paths to base asset directories. With trailing slashes.
// - `path.source` - Path to the source files. Default: `assets/`
// - `path.dist` - Path to the build directory. Default: `dist/`
var path = manifest.paths;

// `config` - Store arbitrary configuration values here.
var config = manifest.config || {};

// `globs` - These ultimately end up in their respective `gulp.src`.
// - `globs.js` - Array of asset-builder JS dependency objects. Example:
//   ```
//   {type: 'js', name: 'main.js', globs: []}
//   ```
// - `globs.css` - Array of asset-builder CSS dependency objects. Example:
//   ```
//   {type: 'css', name: 'main.css', globs: []}
//   ```
// - `globs.fonts` - Array of font path globs.
// - `globs.images` - Array of image path globs.
// - `globs.bower` - Array of all the main Bower files.
var globs = manifest.globs;

// `project` - paths to first-party assets.
// - `project.js` - Array of first-party JS assets.
// - `project.css` - Array of first-party CSS assets.
var project = manifest.getProjectGlobs();

// CLI options
var enabled = {
  // Enable static asset revisioning when `--production`
  rev: argv.production,
  // Disable source maps when `--production`
  maps: !argv.production,
  // Fail styles task on error when `--production`
  failTask: argv.production,
  // Fail due to ESLint warnings only when `--production`
  failLint: argv.production,
  // Strip debug statments from javascript when `--production`
  stripJSDebug: argv.production,
  // Use online RealFavicons API when `--production`
  realFaviconAPI: argv.production
};

// Path to the compiled assets manifest in the dist directory
var revManifest = path.dist + 'assets.json';

// ## Reusable Pipelines
// See https://github.com/OverZealous/lazypipe

// ### CSS processing pipeline
// Example
// ```
// gulp.src(cssFiles)
//   .pipe(cssTasks('main.css')
//   .pipe(gulp.dest(path.dist + 'styles'))
// ```
var cssTasks = (filename) =>
  lazypipe()
    .pipe(() =>
      gulpif(!enabled.failTask, plumber())
    )
    .pipe(() =>
      gulpif(enabled.maps, sourcemaps.init())
    )
    //.pipe(() =>
    //  gulpif('*.less', less())
    //)
    .pipe(() =>
      gulpif('*.scss', sass({
        outputStyle: 'nested',
        precision: 10,
        includePaths: ['.'],
        errLogToConsole: !enabled.failTask
      }))
    )
    .pipe(concat, filename)
    .pipe(autoprefixer, {
      browsers: [
        'last 2 versions',
        'ie >= 9',
        'and_chr >= 2.3'
      ]
    })
    .pipe(cssnano, {
      safe: true
    })
    .pipe(() =>
      gulpif(enabled.rev, rev())
    )
    .pipe(() =>
      gulpif(enabled.maps, sourcemaps.write('.', {
        sourceRoot: 'assets/styles/'
      }))
    )();

// ### JS processing pipeline
// Example
// ```
// gulp.src(jsFiles)
//   .pipe(jsTasks('main.js')
//   .pipe(gulp.dest(path.dist + 'scripts'))
// ```
var jsTasks = (filename) =>
  lazypipe()
    .pipe(() =>
      gulpif(enabled.maps, sourcemaps.init())
    )
    .pipe(babel, {
      presets: ['es2015'],
      plugins: ['transform-es2015-modules-umd'],
      only: [path.source + 'scripts/blob.js']
    })
    .pipe(concat, filename)
    .pipe(uglify, {
      //preserveComments: 'license',
      compress: {
        'drop_debugger': enabled.stripJSDebug
      }
    })
    .pipe(() =>
      gulpif(enabled.rev, rev())
    )
    .pipe(() =>
      gulpif(enabled.maps, sourcemaps.write('.', {
        sourceRoot: 'assets/scripts/'
      }))
    )();

var tasksInstance = (type, extension, tasks) => {
  let merged = merge();
  manifest.forEachDependency(extension, (dep) => {
    let currentTasksInstance = tasks(dep.name);
    if (!enabled.failTask) {
      currentTasksInstance.on('error', (err) => {
        gutil.log(err.toString());
        currentTasksInstance.emit('end');
      });
    }
    merged.add(gulp.src(dep.globs, { base: type })
        .pipe(currentTasksInstance)
    );
  });
  return merged
    .pipe(writeToManifest(type));
}

// ### Write to rev manifest
// If there are any revved files then write them to the rev manifest.
// See https://github.com/sindresorhus/gulp-rev
var writeToManifest = (directory) =>
  lazypipe()
    .pipe(gulp.dest, path.dist + directory)
    .pipe(browserSync.stream, {match: '**/*.{js,css}'})
    .pipe(rev.manifest, revManifest, {
      base: path.dist,
      merge: true
    })
    .pipe(gulp.dest, path.dist)()
;

// ## Gulp tasks
// Run `gulp -T` for a task summary

// ### Styles
// `gulp styles` - Compiles, combines, and optimizes Bower CSS and project CSS.
// By default this task will only log a warning if a precompiler error is
// raised. If the `--production` flag is set: this task will fail outright.
gulp.task('styles', ['wiredep', 'sasslint'], () =>
  tasksInstance('styles', 'css', cssTasks)
);


// ### Scripts
// `gulp scripts` - Runs ESLint then compiles, combines, and optimizes Bower JS
// and project JS.
gulp.task('scripts', ['jslint'], () =>
  tasksInstance('scripts', 'js', jsTasks)
);

// ### Fonts
// `gulp fonts` - Grabs all the fonts and outputs them in a flattened directory
// structure. See: https://github.com/armed/gulp-flatten
gulp.task('fonts', () =>
  gulp.src(globs.fonts)
    .pipe(flatten())
    .pipe(gulp.dest(path.dist + 'fonts'))
    .pipe(browserSync.stream())
);

// ### Images
// `gulp images` - Run lossless compression on all the images.
gulp.task('images', () =>
  gulp.src(globs.images)
    .pipe(imagemin({
      progressive: true,
      interlaced: true,
      svgoPlugins: [{ removeUnknownsAndDefaults: false }, { cleanupIDs: false }]
    }))
    .pipe(gulp.dest(path.dist + 'images'))
    .pipe(browserSync.stream())
);

// ### Videos
// `gulp videos` - Run lossless compression on all the videos.
gulp.task('videos', () =>
  gulp.src(path.source + 'videos/**/*')
    .pipe(gulp.dest(path.dist + 'videos'))
    .pipe(browserSync.stream())
);

// ### Favicons
// `gulp favicons` - Tranform the favicon image to all favicon files.
gulp.task('favicons', () =>
  gulp.src(path.source + 'favicons/**/*')
    .pipe(favicons({
      appName: 'Inspire',
      appDescription: 'Junior-Entreprise de Télécom Saint-Étienne',
      url: 'https://inspire-telecom.com/',
      developerName: 'Léo Colombaro',
      developerURL: 'http://colombaro.fr/',
      online: enabled.realFaviconAPI,
      path: 'https://inspire-telecom.com/assets/icons/',
      html: path.source + '../templates/includes/favicons.html',
      replace: true
    }))
    .pipe(gulp.dest(path.dist + 'icons'))
    .pipe(browserSync.stream())
);

// ### Icons Symboles
// `gulp icons` - Tranform the SVG icons into SVG symboles.
gulp.task('icons', () =>
  gulp.src(path.source + 'icons/**/*.svg')
    .pipe(svgSprite({
      'shape': {
        'id': {
          'separator': '-'
        },
        'align': path.source + 'icons/icons.yaml'
      },
      'svg': {
        'xmlDeclaration': false,
        'doctypeDeclaration': false,
        'dimensionAttributes': false
      },
      'mode': {
        'symbol': {
          'dest': '.',
          'sprite': 'icons/icons-store.svg'
        }
      }
    }))
    .pipe(gulp.dest(path.dist))
    .pipe(browserSync.stream())
);

// ### ESLint
// `gulp lint` - Lints configuration JSON and project JS.
gulp.task('jslint', () =>
  gulp.src([
    'gulpfile.js'
  ].concat(project.js))
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(gulpif(enabled.failLint, eslint.failAfterError()))
);

// ### Sass Lint
// `gulp sasslint` - Lints configuration JSON and project JS.
gulp.task('sasslint', () =>
  gulp.src(path.source + 'styles/*/*.scss')
    .pipe(sassLint())
    .pipe(sassLint.format())
    .pipe(gulpif(enabled.failLint, sassLint.failOnError()))
);

// ### Clean
// `gulp clean` - Deletes the build folder entirely.
gulp.task('clean', require('del').bind(null, [path.dist]));

// ### Watch
// `gulp watch` - Use BrowserSync to proxy your dev server and synchronize code
// changes across devices. Specify the hostname of your dev server at
// `manifest.config.devUrl`. When a modification is made to an asset, run the
// build step for that asset and inject the changes into the page.
// See: http://www.browsersync.io
gulp.task('watch', () => {
  browserSync.init({
    files: ['{src,templates}/**/*.{php,phtml,html}'],
    proxy: config.devUrl
  });
  gulp.watch([path.source + 'styles/**/*'], ['sasslint', 'styles']);
  gulp.watch([path.source + 'scripts/**/*'], ['jslint', 'scripts']);
  gulp.watch([path.source + 'fonts/**/*'], ['fonts']);
  gulp.watch([path.source + 'images/**/*'], ['images']);
  gulp.watch([path.source + 'videos/**/*'], ['videos']);
  gulp.watch([path.source + 'favicons/**/*'], ['favicons']);
  //gulp.watch([path.source + 'icons/**/*'], ['icons']);
  gulp.watch(['bower.json', 'assets/manifest.json'], ['build']);
});

// ### Build
// `gulp build` - Run all the build tasks but don't clean up beforehand.
// Generally you should be running `gulp` instead of `gulp build`.
gulp.task('build', (callback) => {
  runSequence('styles',
              'scripts',
              ['fonts', 'images', 'videos', 'favicons'],
              callback);
});

// ### Wiredep
// `gulp wiredep` - Automatically inject Less and Sass Bower dependencies. See
// https://github.com/taptapship/wiredep
gulp.task('wiredep', () => {
  let wiredep = require('wiredep').stream;
  return gulp.src(project.css)
    .pipe(wiredep())
    .pipe(changed(path.source + 'styles', {
      hasChanged: changed.compareSha1Digest
    }))
    .pipe(gulp.dest(path.source + 'styles'));
});

// ### Gulp
// `gulp` - Run a complete build. To compile for production run `gulp --production`.
gulp.task('default', ['clean'], () =>
  gulp.start('build')
);
