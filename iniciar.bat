@echo off
rem Inicia o servidor local e abre o navegador (duplo clique).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1" %*
