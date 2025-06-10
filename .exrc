set tabstop=2 softtabstop=0 expandtab shiftwidth=2 smarttab

let g:ctrlp_user_command = ['.git/', "cd %s && rg --files-with-matches --hidden --glob='!{docs,.git}/**' '.*'"]

let g:ale_fix_on_save = 1
let g:ale_fixers['typescript'] = ['prettier', 'eslint']
let g:ale_fixers['yaml'] = ['prettier']
let g:ale_fixers['markdown'] = ['prettier']

autocmd BufRead *tests/sass.test.ts,*src/utilities.ts,*src/lib/media-queries.ts call TemplateLiteralSyntax(['css', 'scss'])

source ~/.vim/coc.vim

call coc#config('tsserver.enable', v:true)
" call coc#config('eslint.enable', v:true)

" Use K to show documentation in preview window.
nnoremap <silent> K :call <SID>show_documentation()<CR>

function! s:show_documentation()
  if CocAction('hasProvider', 'hover')
    call CocActionAsync('doHover')
  else
    call feedkeys('K', 'in')
  endif
endfunction

colorscheme carbonfox
