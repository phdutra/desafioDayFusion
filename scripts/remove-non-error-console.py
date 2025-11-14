#!/usr/bin/env python3
"""
Script para remover console.info, console.log, console.warn e console.debug
Mantém apenas console.error
"""
import os
import re
import sys

def remove_non_error_console(content):
    """Remove console.info, console.log, console.warn, console.debug mas mantém console.error"""
    lines = content.split('\n')
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Verifica se a linha contém console.info, console.log, console.warn ou console.debug
        if re.search(r'console\.(info|log|warn|debug)', line):
            # Se a linha está vazia ou só tem espaços após remover o console, pula
            stripped = line.strip()
            if stripped.startswith('console.'):
                # Linha completa é um console - remove
                i += 1
                continue
            
            # Se tem código antes do console, tenta remover só o console
            # Mas por segurança, remove a linha inteira se contém console não-error
            i += 1
            continue
        
        result.append(line)
        i += 1
    
    return '\n'.join(result)

def process_file(filepath):
    """Processa um arquivo removendo console não-error"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original_content = content
        new_content = remove_non_error_console(content)
        
        if original_content != new_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            return True
        return False
    except Exception as e:
        print(f"Erro ao processar {filepath}: {e}", file=sys.stderr)
        return False

def main():
    frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'src')
    
    if not os.path.exists(frontend_dir):
        print(f"Diretório não encontrado: {frontend_dir}", file=sys.stderr)
        sys.exit(1)
    
    extensions = ['.ts', '.js']
    count = 0
    
    for root, dirs, files in os.walk(frontend_dir):
        # Ignora node_modules e outros diretórios
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', 'dist']]
        
        for file in files:
            if any(file.endswith(ext) for ext in extensions):
                # Ignorar arquivos minificados/gerados
                if 'widget.js' in file or 'dist' in root or 'node_modules' in root:
                    continue
                filepath = os.path.join(root, file)
                if process_file(filepath):
                    count += 1
                    print(f"Processado: {filepath}")
    
    print(f"\nTotal de arquivos modificados: {count}")

if __name__ == '__main__':
    main()

