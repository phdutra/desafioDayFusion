FROM public.ecr.aws/lambda/python:3.11

# Copiar requirements e instalar dependências
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código do handler
COPY handler.py ${LAMBDA_TASK_ROOT}/

# Definir handler
CMD ["handler.handler"]

