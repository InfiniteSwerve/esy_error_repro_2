# esy_error_repro_2
Reproduction for the following esy error:
```
info esy 0.6.12-dev (using package.json)
esy: internal error, uncaught exception:
     Stack overflow
     Raised at Lwt.Miscellaneous.poll in file "src/core/lwt.ml", line 3072, characters 20-29
     Called from Lwt_main.run.run_loop in file "src/unix/lwt_main.ml", line 31, characters 10-20
     Called from Lwt_main.run in file "src/unix/lwt_main.ml", line 60, characters 2-13
     Re-raised at Lwt_main.run in file "src/unix/lwt_main.ml", line 124, characters 4-13
     Called from EsyLib__Cli.runAsyncToCmdlinerRet in file "esy-lib/Cli.re", line 264, characters 9-28
     Called from Cmdliner_term.app.(fun) in file "cmdliner_term.ml", line 25, characters 19-24
     Called from Cmdliner.Term.ret.(fun) in file "cmdliner.ml", line 25, characters 27-34
     Called from Cmdliner.Term.run in file "cmdliner.ml", line 116, characters 32-39
```
# Reproduction Steps

To reproduce, simply clone the repo and run `esy`.
