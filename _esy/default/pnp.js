#!/usr/bin/env node
/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, $$BLACKLIST, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const $$BLACKLIST = null;
const ignorePattern = $$BLACKLIST ? new RegExp($$BLACKLIST) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = new Map();
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}/;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![A-Za-z]:)(?!\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
["@esy-ocaml/substs",
new Map([["0.0.1",
         {
           packageLocation: "/home/thetis/.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
           packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"]])}]])],
  ["@opam/base",
  new Map([["github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__base__22697f65/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/dune-configurator",
                                             "opam:3.0.3"],
                                             ["@opam/sexplib0",
                                             "github:EduardoRFS/sexplib0:sexplib0.opam#6785e5fe565bdbcdbc00d861654b4f468d7a552c"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/base-threads",
  new Map([["opam:base",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"]])}]])],
  ["@opam/base-unix",
  new Map([["opam:base",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-unix", "opam:base"]])}]])],
  ["@opam/base_bigstring",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__base__bigstring__opam__c__v0.14.0__19ef1c8b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/base_bigstring",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/base_quickcheck",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__base__quickcheck__opam__c__v0.14.1__c20699fe/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.14.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_let",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_value",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/splittable_random",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/bin_prot",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__bin__prot__opam__c__v0.14.0__0ce63e6b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_custom_printf",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.14.3"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppx_variants_conv",
                                             "opam:v0.14.2"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/core",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__core__opam__c__v0.14.1__74d29b53/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/core", "opam:v0.14.1"],
                                             ["@opam/core_kernel",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/jst-config",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["@opam/spawn", "opam:v0.15.0"],
                                             ["@opam/timezone",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/core_kernel",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__core__kernel__opam__c__v0.14.0__312e7568/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/base_bigstring",
                                             "opam:v0.14.0"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.14.1"],
                                             ["@opam/bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/core_kernel",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/fieldslib",
                                             "opam:v0.14.0"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.14.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_hash",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.0"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["@opam/splittable_random",
                                             "opam:v0.14.0"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["@opam/time_now",
                                             "opam:v0.14.0"],
                                             ["@opam/typerep",
                                             "opam:v0.14.0"],
                                             ["@opam/variantslib",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/core_unix",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__core__unix__opam__c__v0.14.0__54d9a2c1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/core", "opam:v0.14.1"],
                                             ["@opam/core_unix",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/csexp",
  new Map([["opam:1.5.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__csexp__opam__c__1.5.1__a5d42d7e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/dune",
  new Map([["opam:3.0.3",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__dune__opam__c__3.0.3__7e857f11/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base-threads",
                                             "opam:base"],
                                             ["@opam/base-unix", "opam:base"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/dune-configurator",
  new Map([["opam:3.0.3",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__dune_configurator__opam__c__3.0.3__bb5a7828/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/csexp", "opam:1.5.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/dune-configurator",
                                             "opam:3.0.3"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/fieldslib",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__fieldslib__opam__c__v0.14.0__63238cb4/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/fieldslib",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/jane-street-headers",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__jane_street_headers__opam__c__v0.14.0__2ed620b8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/jbuilder",
  new Map([["opam:1.0+beta20.2",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__jbuilder__opam__c__1.0+beta20.2__7e7d6e73/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/jbuilder",
                                             "opam:1.0+beta20.2"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/jst-config",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__jst_config__opam__c__v0.14.1__d0762df8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/dune-configurator",
                                             "opam:3.0.3"],
                                             ["@opam/jst-config",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/num",
  new Map([["opam:1.4",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__num__opam__c__1.4__a26086aa/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/num", "opam:1.4"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.3"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ocaml-compiler-libs",
  new Map([["opam:v0.12.4",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.4__35cddb8b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.4"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ocamlfind",
  new Map([["opam:1.9.3",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ocamlfind__opam__c__1.9.3__67ced71b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/ocamlfind",
                                             "opam:1.9.3"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/octavius",
  new Map([["opam:1.2.2",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__octavius__opam__c__1.2.2__96807fc5/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/octavius", "opam:1.2.2"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/parsexp",
  new Map([["opam:v0.14.2",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__parsexp__opam__c__v0.14.2__97598992/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/parsexp",
                                             "opam:v0.14.2"],
                                             ["@opam/sexplib0",
                                             "github:EduardoRFS/sexplib0:sexplib0.opam#6785e5fe565bdbcdbc00d861654b4f468d7a552c"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_assert",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__assert__opam__c__v0.14.0__e9858357/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_cold",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_base",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__base__opam__c__v0.14.0__8be83b17/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_cold",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_enumerate",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_hash",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_js_style",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_bench",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__bench__opam__c__v0.14.1__0150ca22/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_bench",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_bin_prot",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__bin__prot__opam__c__v0.14.0__ee186529/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_cold",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__cold__opam__c__v0.14.0__20831c56/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_cold",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_compare",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__compare__opam__c__v0.14.0__d8a7262e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_custom_printf",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__custom__printf__opam__c__v0.14.0__cc1a0eed/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_custom_printf",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_derivers",
  new Map([["opam:1.2.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__136a746e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_enumerate",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__enumerate__opam__c__v0.14.0__5fc8f5bc/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_enumerate",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_expect",
  new Map([["opam:v0.14.2",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__expect__opam__c__v0.14.2__339f33b8/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_expect",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/re", "opam:1.8.0"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_fields_conv",
  new Map([["opam:v0.14.2",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__fields__conv__opam__c__v0.14.2__1e26fc9a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/fieldslib",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_fixed_literal",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__fixed__literal__opam__c__v0.14.0__3e956caf/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_fixed_literal",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_hash",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__hash__opam__c__v0.14.0__1593d625/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_hash",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_here",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__here__opam__c__v0.14.0__fefd8712/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_inline_test",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__inline__test__opam__c__v0.14.1__ba73c193/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/time_now",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_jane",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__jane__opam__c__v0.14.0__2caa76bd/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base_quickcheck",
                                             "opam:v0.14.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_bench",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_bin_prot",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_custom_printf",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_expect",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_fixed_literal",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_let",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_module_timer",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.14.3"],
                                             ["@opam/ppx_optional",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_pipebang",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_value",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_stable",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_string",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_typerep_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_variants_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_js_style",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__js__style__opam__c__v0.14.1__927575a1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/octavius", "opam:1.2.2"],
                                             ["@opam/ppx_js_style",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_let",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__let__opam__c__v0.14.0__61e3bda3/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_let",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_module_timer",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__module__timer__opam__c__v0.14.0__bfabd415/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_module_timer",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["@opam/time_now",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_optcomp",
  new Map([["opam:v0.14.3",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__optcomp__opam__c__v0.14.3__a8348810/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.14.3"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_optional",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__optional__opam__c__v0.14.0__ea191660/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_optional",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_pipebang",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__pipebang__opam__c__v0.14.0__ac4eb04b/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_pipebang",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_sexp_conv",
  new Map([["github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__sexp__conv__ee0944c0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/sexplib0",
                                             "github:EduardoRFS/sexplib0:sexplib0.opam#6785e5fe565bdbcdbc00d861654b4f468d7a552c"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_sexp_message",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__sexp__message__opam__c__v0.14.0__ba98ce38/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_sexp_value",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__sexp__value__opam__c__v0.14.0__ea2e86ee/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_here",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/ppx_sexp_value",
                                             "opam:v0.14.0"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_stable",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__stable__opam__c__v0.14.1__910aee3a/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_stable",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_string",
  new Map([["opam:v0.14.1",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__string__opam__c__v0.14.1__edd0f333/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_string",
                                             "opam:v0.14.1"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_typerep_conv",
  new Map([["opam:v0.14.2",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__typerep__conv__opam__c__v0.14.2__ffda30af/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_typerep_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/typerep",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppx_variants_conv",
  new Map([["opam:v0.14.2",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppx__variants__conv__opam__c__v0.14.2__f207dc2d/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_variants_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/variantslib",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/ppxlib",
  new Map([["github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__ppxlib__6ba6f113/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ocaml-compiler-libs",
                                             "opam:v0.12.4"],
                                             ["@opam/ppx_derivers",
                                             "opam:1.2.1"],
                                             ["@opam/ppxlib",
                                             "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"],
                                             ["@opam/sexplib0",
                                             "github:EduardoRFS/sexplib0:sexplib0.opam#6785e5fe565bdbcdbc00d861654b4f468d7a552c"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/re",
  new Map([["opam:1.8.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__re__opam__c__1.8.0__96c3814f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/jbuilder",
                                             "opam:1.0+beta20.2"],
                                             ["@opam/re", "opam:1.8.0"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/seq",
  new Map([["opam:base",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/seq", "opam:base"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/sexplib",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__sexplib__opam__c__v0.14.0__0ac5a13c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/num", "opam:1.4"],
                                             ["@opam/parsexp",
                                             "opam:v0.14.2"],
                                             ["@opam/sexplib",
                                             "opam:v0.14.0"],
                                             ["@opam/sexplib0",
                                             "github:EduardoRFS/sexplib0:sexplib0.opam#6785e5fe565bdbcdbc00d861654b4f468d7a552c"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/sexplib0",
  new Map([["github:EduardoRFS/sexplib0:sexplib0.opam#6785e5fe565bdbcdbc00d861654b4f468d7a552c",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__sexplib0__affdebeb/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/sexplib0",
                                             "github:EduardoRFS/sexplib0:sexplib0.opam#6785e5fe565bdbcdbc00d861654b4f468d7a552c"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/spawn",
  new Map([["opam:v0.15.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__spawn__opam__c__v0.15.0__11dda031/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/spawn", "opam:v0.15.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/splittable_random",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__splittable__random__opam__c__v0.14.0__957dda5c/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_assert",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_bench",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_inline_test",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_sexp_message",
                                             "opam:v0.14.0"],
                                             ["@opam/splittable_random",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/stdio",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__stdio__opam__c__v0.14.0__16c0aeaf/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/stdio", "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/stdlib-shims",
  new Map([["opam:0.3.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__stdlib_shims__opam__c__0.3.0__513c478f/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/stdlib-shims",
                                             "opam:0.3.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/textutils",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__textutils__opam__c__v0.14.0__bba720f0/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/core", "opam:v0.14.1"],
                                             ["@opam/core_kernel",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/textutils",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/time_now",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__time__now__opam__c__v0.14.0__d582831e/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/jane-street-headers",
                                             "opam:v0.14.0"],
                                             ["@opam/jst-config",
                                             "opam:v0.14.1"],
                                             ["@opam/ppx_base",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_optcomp",
                                             "opam:v0.14.3"],
                                             ["@opam/time_now",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/timezone",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__timezone__opam__c__v0.14.0__654af384/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/core_kernel",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/timezone",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/typerep",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__typerep__opam__c__v0.14.0__eba89992/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/typerep",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["@opam/variantslib",
  new Map([["opam:v0.14.0",
           {
             packageLocation: "/home/thetis/.esy/source/i/opam__s__variantslib__opam__c__v0.14.0__788f7206/",
             packageDependencies: new Map([["@esy-ocaml/substs", "0.0.1"],
                                             ["@opam/base",
                                             "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/variantslib",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  ["ocaml",
  new Map([["github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396",
           {
             packageLocation: "/home/thetis/.esy/source/i/ocaml__3c096959/",
             packageDependencies: new Map([["ocaml",
                                           "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])],
  [null,
  new Map([[null,
           {
             packageLocation: "/home/thetis/Code/ocaml/test/",
             packageDependencies: new Map([["@opam/core", "opam:v0.14.1"],
                                             ["@opam/core_unix",
                                             "opam:v0.14.0"],
                                             ["@opam/dune", "opam:3.0.3"],
                                             ["@opam/ppx_compare",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_fields_conv",
                                             "opam:v0.14.2"],
                                             ["@opam/ppx_jane",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_let",
                                             "opam:v0.14.0"],
                                             ["@opam/ppx_sexp_conv",
                                             "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"],
                                             ["@opam/re", "opam:1.8.0"],
                                             ["@opam/textutils",
                                             "opam:v0.14.0"],
                                             ["ocaml",
                                             "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"]])}]])]]);

let topLevelLocatorPath = "../../";
let locatorsByLocations = new Map([
["../../", topLevelLocator],
  ["../../../../../.esy/source/i/esy_ocaml__s__substs__0.0.1__19de1ee1/",
  {
    name: "@esy-ocaml/substs",
    reference: "0.0.1"}],
  ["../../../../../.esy/source/i/ocaml__3c096959/",
  {
    name: "ocaml",
    reference: "github:esy-ocaml/ocaml#65e3f82dcd867d2b1f27c84597b3c25259b09396"}],
  ["../../../../../.esy/source/i/opam__s__base__22697f65/",
  {
    name: "@opam/base",
    reference: "github:EduardoRFS/base:base.opam#6ea52922e153b3a3aae6ffbf2379c6f442671ebd"}],
  ["../../../../../.esy/source/i/opam__s__base__bigstring__opam__c__v0.14.0__19ef1c8b/",
  {
    name: "@opam/base_bigstring",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__base__quickcheck__opam__c__v0.14.1__c20699fe/",
  {
    name: "@opam/base_quickcheck",
    reference: "opam:v0.14.1"}],
  ["../../../../../.esy/source/i/opam__s__base_threads__opam__c__base__f282958b/",
  {
    name: "@opam/base-threads",
    reference: "opam:base"}],
  ["../../../../../.esy/source/i/opam__s__base_unix__opam__c__base__93427a57/",
  {
    name: "@opam/base-unix",
    reference: "opam:base"}],
  ["../../../../../.esy/source/i/opam__s__bin__prot__opam__c__v0.14.0__0ce63e6b/",
  {
    name: "@opam/bin_prot",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__core__kernel__opam__c__v0.14.0__312e7568/",
  {
    name: "@opam/core_kernel",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__core__opam__c__v0.14.1__74d29b53/",
  {
    name: "@opam/core",
    reference: "opam:v0.14.1"}],
  ["../../../../../.esy/source/i/opam__s__core__unix__opam__c__v0.14.0__54d9a2c1/",
  {
    name: "@opam/core_unix",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__csexp__opam__c__1.5.1__a5d42d7e/",
  {
    name: "@opam/csexp",
    reference: "opam:1.5.1"}],
  ["../../../../../.esy/source/i/opam__s__dune__opam__c__3.0.3__7e857f11/",
  {
    name: "@opam/dune",
    reference: "opam:3.0.3"}],
  ["../../../../../.esy/source/i/opam__s__dune_configurator__opam__c__3.0.3__bb5a7828/",
  {
    name: "@opam/dune-configurator",
    reference: "opam:3.0.3"}],
  ["../../../../../.esy/source/i/opam__s__fieldslib__opam__c__v0.14.0__63238cb4/",
  {
    name: "@opam/fieldslib",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__jane_street_headers__opam__c__v0.14.0__2ed620b8/",
  {
    name: "@opam/jane-street-headers",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__jbuilder__opam__c__1.0+beta20.2__7e7d6e73/",
  {
    name: "@opam/jbuilder",
    reference: "opam:1.0+beta20.2"}],
  ["../../../../../.esy/source/i/opam__s__jst_config__opam__c__v0.14.1__d0762df8/",
  {
    name: "@opam/jst-config",
    reference: "opam:v0.14.1"}],
  ["../../../../../.esy/source/i/opam__s__num__opam__c__1.4__a26086aa/",
  {
    name: "@opam/num",
    reference: "opam:1.4"}],
  ["../../../../../.esy/source/i/opam__s__ocaml_compiler_libs__opam__c__v0.12.4__35cddb8b/",
  {
    name: "@opam/ocaml-compiler-libs",
    reference: "opam:v0.12.4"}],
  ["../../../../../.esy/source/i/opam__s__ocamlfind__opam__c__1.9.3__67ced71b/",
  {
    name: "@opam/ocamlfind",
    reference: "opam:1.9.3"}],
  ["../../../../../.esy/source/i/opam__s__octavius__opam__c__1.2.2__96807fc5/",
  {
    name: "@opam/octavius",
    reference: "opam:1.2.2"}],
  ["../../../../../.esy/source/i/opam__s__parsexp__opam__c__v0.14.2__97598992/",
  {
    name: "@opam/parsexp",
    reference: "opam:v0.14.2"}],
  ["../../../../../.esy/source/i/opam__s__ppx__assert__opam__c__v0.14.0__e9858357/",
  {
    name: "@opam/ppx_assert",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__base__opam__c__v0.14.0__8be83b17/",
  {
    name: "@opam/ppx_base",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__bench__opam__c__v0.14.1__0150ca22/",
  {
    name: "@opam/ppx_bench",
    reference: "opam:v0.14.1"}],
  ["../../../../../.esy/source/i/opam__s__ppx__bin__prot__opam__c__v0.14.0__ee186529/",
  {
    name: "@opam/ppx_bin_prot",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__cold__opam__c__v0.14.0__20831c56/",
  {
    name: "@opam/ppx_cold",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__compare__opam__c__v0.14.0__d8a7262e/",
  {
    name: "@opam/ppx_compare",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__custom__printf__opam__c__v0.14.0__cc1a0eed/",
  {
    name: "@opam/ppx_custom_printf",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__derivers__opam__c__1.2.1__136a746e/",
  {
    name: "@opam/ppx_derivers",
    reference: "opam:1.2.1"}],
  ["../../../../../.esy/source/i/opam__s__ppx__enumerate__opam__c__v0.14.0__5fc8f5bc/",
  {
    name: "@opam/ppx_enumerate",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__expect__opam__c__v0.14.2__339f33b8/",
  {
    name: "@opam/ppx_expect",
    reference: "opam:v0.14.2"}],
  ["../../../../../.esy/source/i/opam__s__ppx__fields__conv__opam__c__v0.14.2__1e26fc9a/",
  {
    name: "@opam/ppx_fields_conv",
    reference: "opam:v0.14.2"}],
  ["../../../../../.esy/source/i/opam__s__ppx__fixed__literal__opam__c__v0.14.0__3e956caf/",
  {
    name: "@opam/ppx_fixed_literal",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__hash__opam__c__v0.14.0__1593d625/",
  {
    name: "@opam/ppx_hash",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__here__opam__c__v0.14.0__fefd8712/",
  {
    name: "@opam/ppx_here",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__inline__test__opam__c__v0.14.1__ba73c193/",
  {
    name: "@opam/ppx_inline_test",
    reference: "opam:v0.14.1"}],
  ["../../../../../.esy/source/i/opam__s__ppx__jane__opam__c__v0.14.0__2caa76bd/",
  {
    name: "@opam/ppx_jane",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__js__style__opam__c__v0.14.1__927575a1/",
  {
    name: "@opam/ppx_js_style",
    reference: "opam:v0.14.1"}],
  ["../../../../../.esy/source/i/opam__s__ppx__let__opam__c__v0.14.0__61e3bda3/",
  {
    name: "@opam/ppx_let",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__module__timer__opam__c__v0.14.0__bfabd415/",
  {
    name: "@opam/ppx_module_timer",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__optcomp__opam__c__v0.14.3__a8348810/",
  {
    name: "@opam/ppx_optcomp",
    reference: "opam:v0.14.3"}],
  ["../../../../../.esy/source/i/opam__s__ppx__optional__opam__c__v0.14.0__ea191660/",
  {
    name: "@opam/ppx_optional",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__pipebang__opam__c__v0.14.0__ac4eb04b/",
  {
    name: "@opam/ppx_pipebang",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__sexp__conv__ee0944c0/",
  {
    name: "@opam/ppx_sexp_conv",
    reference: "github:janestreet/ppx_sexp_conv:ppx_sexp_conv.opam#3d413303de3f76fecb19dc51c85b81c33c5c872a"}],
  ["../../../../../.esy/source/i/opam__s__ppx__sexp__message__opam__c__v0.14.0__ba98ce38/",
  {
    name: "@opam/ppx_sexp_message",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__sexp__value__opam__c__v0.14.0__ea2e86ee/",
  {
    name: "@opam/ppx_sexp_value",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__ppx__stable__opam__c__v0.14.1__910aee3a/",
  {
    name: "@opam/ppx_stable",
    reference: "opam:v0.14.1"}],
  ["../../../../../.esy/source/i/opam__s__ppx__string__opam__c__v0.14.1__edd0f333/",
  {
    name: "@opam/ppx_string",
    reference: "opam:v0.14.1"}],
  ["../../../../../.esy/source/i/opam__s__ppx__typerep__conv__opam__c__v0.14.2__ffda30af/",
  {
    name: "@opam/ppx_typerep_conv",
    reference: "opam:v0.14.2"}],
  ["../../../../../.esy/source/i/opam__s__ppx__variants__conv__opam__c__v0.14.2__f207dc2d/",
  {
    name: "@opam/ppx_variants_conv",
    reference: "opam:v0.14.2"}],
  ["../../../../../.esy/source/i/opam__s__ppxlib__6ba6f113/",
  {
    name: "@opam/ppxlib",
    reference: "github:patricoferris/ppxlib:ppxlib.opam#91c39e958fca1dabf16f64dc7699ace7752f0014"}],
  ["../../../../../.esy/source/i/opam__s__re__opam__c__1.8.0__96c3814f/",
  {
    name: "@opam/re",
    reference: "opam:1.8.0"}],
  ["../../../../../.esy/source/i/opam__s__seq__opam__c__base__a0c677b1/",
  {
    name: "@opam/seq",
    reference: "opam:base"}],
  ["../../../../../.esy/source/i/opam__s__sexplib0__affdebeb/",
  {
    name: "@opam/sexplib0",
    reference: "github:EduardoRFS/sexplib0:sexplib0.opam#6785e5fe565bdbcdbc00d861654b4f468d7a552c"}],
  ["../../../../../.esy/source/i/opam__s__sexplib__opam__c__v0.14.0__0ac5a13c/",
  {
    name: "@opam/sexplib",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__spawn__opam__c__v0.15.0__11dda031/",
  {
    name: "@opam/spawn",
    reference: "opam:v0.15.0"}],
  ["../../../../../.esy/source/i/opam__s__splittable__random__opam__c__v0.14.0__957dda5c/",
  {
    name: "@opam/splittable_random",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__stdio__opam__c__v0.14.0__16c0aeaf/",
  {
    name: "@opam/stdio",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__stdlib_shims__opam__c__0.3.0__513c478f/",
  {
    name: "@opam/stdlib-shims",
    reference: "opam:0.3.0"}],
  ["../../../../../.esy/source/i/opam__s__textutils__opam__c__v0.14.0__bba720f0/",
  {
    name: "@opam/textutils",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__time__now__opam__c__v0.14.0__d582831e/",
  {
    name: "@opam/time_now",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__timezone__opam__c__v0.14.0__654af384/",
  {
    name: "@opam/timezone",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__typerep__opam__c__v0.14.0__eba89992/",
  {
    name: "@opam/typerep",
    reference: "opam:v0.14.0"}],
  ["../../../../../.esy/source/i/opam__s__variantslib__opam__c__v0.14.0__788f7206/",
  {
    name: "@opam/variantslib",
    reference: "opam:v0.14.0"}]]);


  exports.findPackageLocator = function findPackageLocator(location) {
    let relativeLocation = normalizePath(path.relative(__dirname, location));

    if (!relativeLocation.match(isStrictRegExp))
      relativeLocation = `./${relativeLocation}`;

    if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
      relativeLocation = `${relativeLocation}/`;

    let match;

  
      if (relativeLocation.length >= 86 && relativeLocation[85] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 86)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 85 && relativeLocation[84] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 85)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 84 && relativeLocation[83] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 84)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 83 && relativeLocation[82] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 83)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 82 && relativeLocation[81] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 82)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 81 && relativeLocation[80] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 81)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 80 && relativeLocation[79] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 80)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 79 && relativeLocation[78] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 79)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 78 && relativeLocation[77] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 78)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 77 && relativeLocation[76] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 77)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 76 && relativeLocation[75] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 76)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 75 && relativeLocation[74] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 75)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 74 && relativeLocation[73] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 74)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 73 && relativeLocation[72] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 73)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 72 && relativeLocation[71] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 72)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 71 && relativeLocation[70] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 71)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 70 && relativeLocation[69] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 70)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 69 && relativeLocation[68] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 69)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 67 && relativeLocation[66] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 67)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 66 && relativeLocation[65] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 66)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 64 && relativeLocation[63] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 64)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 57 && relativeLocation[56] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 57)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 55 && relativeLocation[54] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 55)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 53 && relativeLocation[52] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 53)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 45 && relativeLocation[44] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 45)))
          return blacklistCheck(match);
      

      if (relativeLocation.length >= 6 && relativeLocation[5] === '/')
        if (match = locatorsByLocations.get(relativeLocation.substr(0, 6)))
          return blacklistCheck(match);
      

    /*
      this can only happen if inside the _esy
      as any other path will implies the opposite

      topLevelLocatorPath = ../../

      | folder              | relativeLocation |
      | ------------------- | ---------------- |
      | /workspace/app      | ../../           |
      | /workspace          | ../../../        |
      | /workspace/app/x    | ../../x/         |
      | /workspace/app/_esy | ../              |

    */
    if (!relativeLocation.startsWith(topLevelLocatorPath)) {
      return topLevelLocator;
    }
    return null;
  };
  

/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

// eslint-disable-next-line no-unused-vars
function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "$$BLACKLIST")`,
        {
          request,
          issuer
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer
          },
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName},
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName},
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName},
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `,
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates},
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)},
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {},
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath},
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {extensions});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer
          },
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath);
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    if (patchedModules.has(request)) {
      module.exports = patchedModules.get(request)(module.exports);
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    const issuerModule = getIssuerModule(parent);
    const issuer = issuerModule ? issuerModule.filename : process.cwd() + '/';

    const resolution = exports.resolveRequest(request, issuer);
    return resolution !== null ? resolution : request;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths || []) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);

  if (process.env.ESY__NODE_BIN_PATH != null) {
    const delimiter = require('path').delimiter;
    process.env.PATH = `${process.env.ESY__NODE_BIN_PATH}${delimiter}${process.env.PATH}`;
  }
};

exports.setupCompatibilityLayer = () => {
  // see https://github.com/browserify/resolve/blob/master/lib/caller.js
  const getCaller = () => {
    const origPrepareStackTrace = Error.prepareStackTrace;

    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack;
    Error.prepareStackTrace = origPrepareStackTrace;

    return stack[2].getFileName();
  };

  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // We need to shim the "resolve" module, because Liftoff uses it in order to find the location
  // of the module in the dependency tree. And Liftoff is used to power Gulp, which doesn't work
  // at all unless modulePath is set, which we cannot configure from any other way than through
  // the Liftoff pipeline (the key isn't whitelisted for env or cli options).

  patchedModules.set(/^resolve$/, realResolve => {
    const mustBeShimmed = caller => {
      const callerLocator = exports.findPackageLocator(caller);

      return callerLocator && callerLocator.name === 'liftoff';
    };

    const attachCallerToOptions = (caller, options) => {
      if (!options.basedir) {
        options.basedir = path.dirname(caller);
      }
    };

    const resolveSyncShim = (request, {basedir}) => {
      return exports.resolveRequest(request, basedir, {
        considerBuiltins: false,
      });
    };

    const resolveShim = (request, options, callback) => {
      setImmediate(() => {
        let error;
        let result;

        try {
          result = resolveSyncShim(request, options);
        } catch (thrown) {
          error = thrown;
        }

        callback(error, result);
      });
    };

    return Object.assign(
      (request, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        } else if (!options) {
          options = {};
        }

        const caller = getCaller();
        attachCallerToOptions(caller, options);

        if (mustBeShimmed(caller)) {
          return resolveShim(request, options, callback);
        } else {
          return realResolve.sync(request, options, callback);
        }
      },
      {
        sync: (request, options) => {
          if (!options) {
            options = {};
          }

          const caller = getCaller();
          attachCallerToOptions(caller, options);

          if (mustBeShimmed(caller)) {
            return resolveSyncShim(request, options);
          } else {
            return realResolve.sync(request, options);
          }
        },
        isCore: request => {
          return realResolve.isCore(request);
        }
      }
    );
  });
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
