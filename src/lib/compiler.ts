/**
 * PART A: Architecture Skeleton
 */

export enum TokenType {
  KEYWORD = 'KEYWORD',
  IDENTIFIER = 'IDENTIFIER',
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  OPERATOR = 'OPERATOR',
  PUNCTUATION = 'PUNCTUATION',
  EOF = 'EOF'
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  synthetic?: boolean;
}

export interface CompilerError {
  phase: string;
  message: string;
  line: number;
  column: number;
}

export interface ASTNode {
  type: string;
  [key: string]: any;
}

/**
 * Parser (Syntactic Analyzer)
 * 
 * Consumes the token stream from the Lexer and constructs an Abstract Syntax Tree (AST).
 * Employs Phrase-Level error recovery to handle missing tokens or malformed expressions
 * without crashing, allowing for a complete AST to be built even with minor syntax errors.
 * 
 * Input: Token Stream (Array<Token>)
 * Output: Abstract Syntax Tree (AST Node)
 */
export class Parser {
  private current: number = 0;
  private errors: CompilerError[] = [];

  constructor(private tokens: Token[]) {}

  public parse(): { ast: ASTNode, errors: CompilerError[] } {
    const declarations: ASTNode[] = [];
    while (!this.isAtEnd()) {
      declarations.push(this.declaration());
    }
    return { 
      ast: { type: 'Program', body: declarations }, 
      errors: this.errors 
    };
  }

  // --- Phrase-Level Recovery ---
  private consume(type: TokenType, value?: string | null, message?: string): Token {
    if (this.check(type, value || undefined)) return this.advance();
    
    // Phrase-Level Recovery: Log error and synthesize the missing token
    const errLine = this.previous() ? this.previous().line : 1;
    const errCol = this.previous() ? this.previous().column : 1;
    
    this.errors.push({
      phase: 'Parser',
      message: message || `Expected ${value || type}`,
      line: errLine,
      column: errCol
    });

    return { type, value: value || '', line: errLine, column: errCol, synthetic: true };
  }

  // --- Parsing Rules ---
  private parseType(): string {
     let typeStr = '';
     if (this.match(TokenType.KEYWORD, 'struct')) {
         typeStr = 'struct ';
         if (this.check(TokenType.IDENTIFIER)) {
             typeStr += this.advance().value;
         }
     } else if (this.match(TokenType.KEYWORD, 'int') || this.match(TokenType.KEYWORD, 'void') || this.match(TokenType.KEYWORD, 'bool')) {
         typeStr = this.previous().value;
     } else if (this.match(TokenType.IDENTIFIER)) {
         typeStr = this.previous().value; // custom typedef
     } else {
         const t = this.advance();
         this.errors.push({ phase: 'Parser', message: `Expected type specifier, got '${t.value}'`, line: t.line, column: t.column });
         typeStr = 'int';
     }
     
     while (this.match(TokenType.OPERATOR, '*')) {
         typeStr += '*';
     }
     return typeStr;
  }

  private isTypeStart(): boolean {
      if (this.isAtEnd()) return false;
      const t = this.peek();
      if (t.type === TokenType.KEYWORD && ['int', 'void', 'bool', 'struct', 'typedef'].includes(t.value)) {
          return true;
      }
      if (t.type === TokenType.IDENTIFIER) {
          const next = this.peekNext();
          // Heuristic for typedef identifiers
          if (next && (next.value === '*' || next.type === TokenType.IDENTIFIER)) {
              return true;
          }
      }
      return false;
  }

  private declaration(): ASTNode {
    if (this.check(TokenType.KEYWORD, 'struct') && this.peekNext()?.value === '{') {
        return this.structDefinition();
    }
    if (this.check(TokenType.KEYWORD, 'typedef')) {
        return this.typedefDeclaration();
    }
    if (this.isTypeStart()) {
      const startPos = this.current;
      const typeStr = this.parseType();
      
      // If after type it's just a semicolon (e.g. struct Node;)
      if (this.match(TokenType.PUNCTUATION, ';')) {
          return { type: 'EmptyDeclaration', value: typeStr };
      }

      const isFunc = this.peekNext()?.value === '(' || (this.peekNext()?.value === ')' && false) || this.peekNext()?.type === TokenType.PUNCTUATION;
      // Let's rely on next punctuation to differentiate variable vs function
      this.current = startPos; // backtrack
      const typeStrBacktracked = this.parseType(); // consume type again
      const name = this.consume(TokenType.IDENTIFIER, null, "Expected identifier.");
      
      if (this.match(TokenType.PUNCTUATION, '(')) {
          return this.functionDeclaration(typeStrBacktracked, name);
      } else {
          return this.varDeclaration(typeStrBacktracked, name);
      }
    }
    return this.statement();
  }

  private structDefinition(): ASTNode {
    this.consume(TokenType.KEYWORD, 'struct');
    let name = null;
    if (this.check(TokenType.IDENTIFIER)) {
        name = this.advance().value;
    }
    this.consume(TokenType.PUNCTUATION, '{');
    const fields = [];
    while (!this.check(TokenType.PUNCTUATION, '}') && !this.isAtEnd()) {
        const typeStr = this.parseType();
        const fieldName = this.consume(TokenType.IDENTIFIER, null, "Expected field name");
        
        let arraySize = null;
        if (this.match(TokenType.PUNCTUATION, '[')) {
            const sizeT = this.consume(TokenType.NUMBER, null, "Expected array size");
            arraySize = parseInt(sizeT.value, 10);
            this.consume(TokenType.PUNCTUATION, ']');
        }
        
        this.consume(TokenType.PUNCTUATION, ';');
        fields.push({ type: typeStr, name: fieldName.value, arraySize });
    }
    this.consume(TokenType.PUNCTUATION, '}');
    this.consume(TokenType.PUNCTUATION, ';');
    return { type: 'StructDefinition', name, fields };
  }

  private typedefDeclaration(): ASTNode {
    this.consume(TokenType.KEYWORD, 'typedef');
    if (this.match(TokenType.KEYWORD, 'struct')) {
        this.consume(TokenType.PUNCTUATION, '{');
        const fields = [];
        while (!this.check(TokenType.PUNCTUATION, '}') && !this.isAtEnd()) {
            const typeStr = this.parseType();
            const fieldName = this.consume(TokenType.IDENTIFIER, null, "Expected field name");
            let arraySize = null;
            if (this.match(TokenType.PUNCTUATION, '[')) {
                const sizeT = this.consume(TokenType.NUMBER, null, "Expected array size");
                arraySize = parseInt(sizeT.value, 10);
                this.consume(TokenType.PUNCTUATION, ']');
            }
            this.consume(TokenType.PUNCTUATION, ';');
            fields.push({ type: typeStr, name: fieldName.value, arraySize });
        }
        this.consume(TokenType.PUNCTUATION, '}');
        const alias = this.consume(TokenType.IDENTIFIER, null, "Expected typedef alias");
        this.consume(TokenType.PUNCTUATION, ';');
        return { type: 'TypedefStruct', alias: alias.value, fields };
    }
    
    const typeStr = this.parseType();
    const alias = this.consume(TokenType.IDENTIFIER, null, "Expected typedef alias");
    this.consume(TokenType.PUNCTUATION, ';');
    return { type: 'Typedef', originalType: typeStr, alias: alias.value };
  }

  private functionDeclaration(returnType: string, name: Token): ASTNode {
    const params: string[] = [];
    if (!this.check(TokenType.PUNCTUATION, ')')) {
      do {
          const pType = this.parseType();
          const pName = this.consume(TokenType.IDENTIFIER, null, "Expected parameter name.");
          params.push(pName.value);
      } while (this.match(TokenType.PUNCTUATION, ','));
    }

    this.consume(TokenType.PUNCTUATION, ')', "Expected ')' after parameters.");
    const body = this.blockStatement();
    return { type: 'FunctionDeclaration', returnType, name: name.value, params, body, line: name.line, column: name.column };
  }

  private varDeclaration(dataType: string, name: Token): ASTNode {
    let arraySize = null;
    let initializer = null;
    if (this.match(TokenType.PUNCTUATION, '[')) {
        if (!this.check(TokenType.PUNCTUATION, ']')) {
            const sizeT = this.consume(TokenType.NUMBER, null, "Expected array size");
            arraySize = parseInt(sizeT.value, 10);
        }
        this.consume(TokenType.PUNCTUATION, ']');
    }

    if (this.match(TokenType.OPERATOR, '=')) {
        initializer = this.expression();
    }
    this.consume(TokenType.PUNCTUATION, ';', "Missing ';' after variable declaration. (Phrase-Level Recovery applied)");
    return { type: 'VariableDeclaration', dataType, name: name.value, arraySize, initializer, line: name.line, column: name.column };
  }

  private statement(): ASTNode {
    if (this.match(TokenType.KEYWORD, 'if')) return this.ifStatement();
    // FIX: Tell the parser how to identify a while loop
    if (this.match(TokenType.KEYWORD, 'while')) return this.whileStatement(); 
    if (this.match(TokenType.KEYWORD, 'return')) return this.returnStatement();
    if (this.check(TokenType.PUNCTUATION, '{')) return this.blockStatement();
    
    return this.expressionStatement();
  }

  // FIX: Build the AST node for the while loop
  private whileStatement(): ASTNode {
    this.consume(TokenType.PUNCTUATION, '(', "Expected '(' after 'while'.");
    const condition = this.expression();
    this.consume(TokenType.PUNCTUATION, ')', "Expected ')' after condition.");
    const body = this.statement();
    return { type: 'WhileStatement', condition, body };
  }

  private ifStatement(): ASTNode {
    this.consume(TokenType.PUNCTUATION, '(', "Expected '(' after 'if'.");
    const condition = this.expression();
    this.consume(TokenType.PUNCTUATION, ')', "Expected ')' after condition.");
    const thenBranch = this.statement();
    return { type: 'IfStatement', condition, thenBranch };
  }

  private returnStatement(): ASTNode {
    let value = null;
    if (!this.check(TokenType.PUNCTUATION, ';')) {
        value = this.expression();
    }
    this.consume(TokenType.PUNCTUATION, ';', "Missing ';' after return value. (Phrase-Level Recovery applied)");
    return { type: 'ReturnStatement', value };
  }

  private blockStatement(): ASTNode {
    this.consume(TokenType.PUNCTUATION, '{', "Expected '{' to start block.");
    const statements: ASTNode[] = [];
    while (!this.check(TokenType.PUNCTUATION, '}') && !this.isAtEnd()) {
        statements.push(this.declaration());
    }
    this.consume(TokenType.PUNCTUATION, '}', "Expected '}' to end block.");
    return { type: 'BlockStatement', body: statements };
  }

  private expressionStatement(): ASTNode {
    const expr = this.expression();
    this.consume(TokenType.PUNCTUATION, ';', "Missing ';' after expression. (Phrase-Level Recovery applied)");
    return { type: 'ExpressionStatement', expression: expr };
  }

  private expression(): ASTNode {
    return this.assignment();
  }

  private assignment(): ASTNode {
    let expr = this.equality();
    if (this.match(TokenType.OPERATOR, '=')) {
        const equalsToken = this.previous();
        const value = this.assignment(); 

        if (expr.type === 'Identifier' || expr.type === 'ArrayAccess' || expr.type === 'MemberExpression' || expr.type === 'DereferenceExpression') {
            return { type: 'AssignmentExpression', left: expr, right: value, line: equalsToken.line, column: equalsToken.column };
        }
        
        this.errors.push({ phase: 'Parser', message: 'Invalid assignment target.', line: equalsToken.line, column: equalsToken.column });
    }
    return expr;
  }

  private equality(): ASTNode {
    let expr = this.relational();
    while (this.match(TokenType.OPERATOR, '==') || this.match(TokenType.OPERATOR, '!=')) {
        const operator = this.previous().value;
        const right = this.relational();
        expr = { type: 'BinaryExpression', operator, left: expr, right };
    }
    return expr;
  }

  private relational(): ASTNode {
    let expr = this.term();
    while (this.match(TokenType.OPERATOR, '<') || this.match(TokenType.OPERATOR, '>') || this.match(TokenType.OPERATOR, '<=') || this.match(TokenType.OPERATOR, '>=')) {
        const operator = this.previous().value;
        const right = this.term();
        expr = { type: 'BinaryExpression', operator, left: expr, right };
    }
    return expr;
  }

  private term(): ASTNode {
    let expr = this.factor();
    while (this.match(TokenType.OPERATOR, '+') || this.match(TokenType.OPERATOR, '-')) {
        const operator = this.previous().value;
        const right = this.factor();
        expr = { type: 'BinaryExpression', operator, left: expr, right };
    }
    return expr;
  }

  private factor(): ASTNode {
    let expr = this.unary();
    while (this.match(TokenType.OPERATOR, '*') || this.match(TokenType.OPERATOR, '/')) {
        const operator = this.previous().value;
        const right = this.unary();
        expr = { type: 'BinaryExpression', operator, left: expr, right };
    }
    return expr;
  }

  private unary(): ASTNode {
    if (this.match(TokenType.OPERATOR, '!') || this.match(TokenType.OPERATOR, '*') || this.match(TokenType.OPERATOR, '&') || this.match(TokenType.OPERATOR, '-')) {
        const operator = this.previous().value;
        const right = this.unary();
        if (operator === '*') {
             return { type: 'DereferenceExpression', argument: right };
        } else if (operator === '&') {
             return { type: 'AddressOfExpression', argument: right };
        }
        return { type: 'UnaryExpression', operator, right };
    }
    return this.postfix();
  }

  private postfix(): ASTNode {
    let expr = this.primary();
    while (true) {
        if (this.match(TokenType.PUNCTUATION, '[')) {
            const index = this.expression();
            this.consume(TokenType.PUNCTUATION, ']', "Expected ']' after array index.");
            expr = { type: 'ArrayAccess', object: expr, index };
        } else if (this.match(TokenType.PUNCTUATION, '(')) {
            const args: ASTNode[] = [];
            if (!this.check(TokenType.PUNCTUATION, ')')) {
                do {
                    args.push(this.expression());
                } while (this.match(TokenType.PUNCTUATION, ','));
            }
            this.consume(TokenType.PUNCTUATION, ')', "Expected ')' after arguments.");
            let calleeName = 'unknown';
            if (expr.type === 'Identifier') calleeName = expr.name;
            expr = { type: 'CallExpression', callee: calleeName, arguments: args };
        } else if (this.match(TokenType.OPERATOR, '->') || this.match(TokenType.PUNCTUATION, '.')) {
            const operator = this.previous().value;
            const property = this.consume(TokenType.IDENTIFIER, null, "Expected property name.");
            expr = { type: 'MemberExpression', object: expr, operator, property: property.value };
        } else if (this.match(TokenType.OPERATOR, '++') || this.match(TokenType.OPERATOR, '--')) {
            const operator = this.previous().value;
            expr = { type: 'UpdateExpression', operator, argument: expr, prefix: false };
        } else {
            break;
        }
    }
    return expr;
  }

  private primary(): ASTNode {
    if (this.match(TokenType.STRING)) {
        return { type: 'StringLiteral', value: this.previous().value };
    }
    if (this.match(TokenType.NUMBER)) {
        return { type: 'NumberLiteral', value: parseInt(this.previous().value, 10) };
    }
    if (this.match(TokenType.IDENTIFIER)) {
        const t = this.previous();
        return { type: 'Identifier', name: t.value, line: t.line, column: t.column };
    }
    if (this.match(TokenType.PUNCTUATION, '(')) {
        const expr = this.expression();
        this.consume(TokenType.PUNCTUATION, ')', "Expected ')' after expression.");
        return expr;
    }
    
    // Panic mode for unrecoverable expression token
    const badToken = this.advance();
    this.errors.push({
        phase: 'Parser',
        message: `Unexpected token '${badToken.value}' in expression.`,
        line: badToken.line,
        column: badToken.column
    });
    return { type: 'ErrorNode', value: badToken.value };
  }

  // --- Utilities ---
  private match(type: TokenType, value?: string): boolean {
    if (this.check(type, value)) {
        this.advance();
        return true;
    }
    return false;
  }

  private check(type: TokenType, value?: string): boolean {
    if (this.isAtEnd()) return false;
    const peeked = this.peek();
    if (peeked.type !== type) return false;
    if (value !== undefined && peeked.value !== value) return false;
    return true;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private peekNext(): Token | undefined {
    if (this.current + 1 >= this.tokens.length) return undefined;
    return this.tokens[this.current + 1];
  }

  private peekNextNext(): Token | undefined {
    if (this.current + 2 >= this.tokens.length) return undefined;
    return this.tokens[this.current + 2];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }
}

export class SymbolTable {
  private scopes: Map<string, any>[] = [new Map()];

  public enterScope(): void {
    this.scopes.push(new Map());
  }

  public exitScope(): void {
    if (this.scopes.length > 1) {
      this.scopes.pop();
    }
  }

  public define(name: string, type: string): boolean {
    const currentScope = this.scopes[this.scopes.length - 1];
    if (currentScope.has(name)) {
      return false; // Already defined in current scope
    }
    currentScope.set(name, { type });
    return true;
  }

  public resolve(name: string): any | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        return this.scopes[i].get(name);
      }
    }
    return null; // Not found
  }

  public getScopes(): any[] {
    return this.scopes.map(map => Object.fromEntries(map));
  }
}

/**
 * Semantic Analyzer
 * 
 * Traverses the AST output by the Parser to verify semantic correctness.
 * Manages a scoped Symbol Table using a hash map to keep track of variable declarations,
 * types, and scope levels. Detects type mismatches, undeclared variables, etc.
 * 
 * Input: Abstract Syntax Tree (AST Node)
 * Output: Annotated AST or Symbol Table state
 */
export class SemanticAnalyzer {
  private symbolTable = new SymbolTable();
  private errors: CompilerError[] = [];

  public analyze(ast: ASTNode): { ast: ASTNode, errors: CompilerError[], scopes: any[] } {
    this.visit(ast);
    return { ast, errors: this.errors, scopes: this.symbolTable.getScopes() };
  }

  private visit(node: ASTNode | null): void {
    if (!node) return;
    
    switch (node.type) {
      case 'Program':
        for (const stmt of node.body) {
          this.visit(stmt);
        }
        break;
      case 'BlockStatement':
        this.symbolTable.enterScope();
        for (const stmt of node.body) {
          this.visit(stmt);
        }
        this.symbolTable.exitScope();
        break;
      case 'FunctionDeclaration':
        if (!this.symbolTable.define(node.name, 'function')) {
          this.error(`Function '${node.name}' already declared.`, node);
        }
        
        // FIX: Open the scope and inject parameters BEFORE traversing the body
        this.symbolTable.enterScope();
        if (node.params) {
            node.params.forEach((param: string) => {
                this.symbolTable.define(param, 'int');
            });
        }
        this.visit(node.body);
        this.symbolTable.exitScope();
        break;

      case 'WhileStatement':
        // FIX: Ensure the semantic analyzer checks variables inside loops
        this.visit(node.condition);
        this.visit(node.body);
        break;

      case 'CallExpression':
        node.arguments.forEach((arg: any) => this.visit(arg));
        // FIX: Whitelist 'printf' so it doesn't throw undeclared errors
        if (node.callee !== 'malloc' && node.callee !== 'free' && node.callee !== 'printf' && !this.symbolTable.resolve(node.callee)) {
          this.error(`Undeclared function '${node.callee}'`, node);
        }
        break;
      case 'VariableDeclaration':
        this.visit(node.initializer);
        if (!this.symbolTable.define(node.name, 'int')) {
          this.error(`Variable '${node.name}' already declared in this scope.`, node);
        }
        break;
      case 'ExpressionStatement':
        this.visit(node.expression);
        break;
      case 'AssignmentExpression':
        this.visit(node.left);
        this.visit(node.right);
        break;
      case 'IfStatement':
        this.visit(node.condition);
        this.visit(node.thenBranch);
        break;
      case 'ReturnStatement':
        this.visit(node.value);
        break;
      case 'BinaryExpression':
        this.visit(node.left);
        this.visit(node.right);
        break;
      case 'CallExpression':
        node.arguments.forEach((arg: any) => this.visit(arg));
        if (node.callee !== 'malloc' && node.callee !== 'free' && node.callee !== 'printf' && !this.symbolTable.resolve(node.callee)) {
          this.error(`Undeclared function '${node.callee}'`, node);
        }
        break;
      case 'Identifier':
        if (!this.symbolTable.resolve(node.name)) {
          this.error(`Undeclared variable '${node.name}'.`, node);
        }
        break;
      case 'NumberLiteral':
      case 'ErrorNode':
        // Nothing to do for literals or existing errors
        break;
      default:
        break;
    }
  }

  private error(message: string, node: ASTNode): void {
    this.errors.push({
      phase: 'Semantic',
      message: message,
      line: node.line || 1,
      column: node.column || 1
    });
  }
}

/**
 * VirtualMachine (Memory Management & Execution)
 */
export interface ActivationRecord {
  functionName: string;
  locals: Record<string, any>;
}

export interface MemoryDump {
  static: Record<string, any>;
  stack: ActivationRecord[];
  heap: { address: string; size: number; free: boolean; data: any }[];
}

export class VirtualMachine {
  private staticMemory: Record<string, any> = {};
  private stack: ActivationRecord[] = [];
  private heap: { address: string; size: number; free: boolean; data: any }[] = [];
  private nextHeapAddress = 0x1000;
  private functions: Record<string, ASTNode> = {};
  
  public finalDump: MemoryDump | null = null;
  public history: MemoryDump[] = [];
  public runtimeErrors: CompilerError[] = [];
  private instructionCount: number = 0;

  private recordSnapshot() {
    // Deep copy the memory state to prevent references from overwriting the history
    this.history.push(JSON.parse(JSON.stringify(this.dump_memory_state())));
  }

  public dump_memory_state(): MemoryDump {
    return {
      static: { ...this.staticMemory },
      stack: JSON.parse(JSON.stringify(this.stack)),
      heap: JSON.parse(JSON.stringify(this.heap))
    };
  }

  public execute(ast: ASTNode): { finalDump: MemoryDump; history: MemoryDump[] } {
    this.staticMemory = {};
    this.stack = [];
    this.heap = [];
    this.functions = {};
    this.nextHeapAddress = 0x1000;
    this.runtimeErrors = [];
    this.instructionCount = 0;
    this.finalDump = null;
    this.history = [];

    if (ast && ast.type === 'Program') {
      for (const decl of ast.body) {
        if (decl.type === 'FunctionDeclaration') {
          this.functions[decl.name] = decl;
        } else if (decl.type === 'VariableDeclaration') {
          this.staticMemory[decl.name] = this.evaluate(decl.initializer);
        }
      }
    }

    // SNAPSHOT: After global variables are loaded, before main() starts
    this.recordSnapshot(); 

    try {
        if (this.functions['main']) {
          this.callFunction('main', []);
        }
    } catch (e: any) {
        this.runtimeErrors.push({
            phase: 'Runtime',
            message: e.message || String(e),
            line: 0,
            column: 0
        });
    }

    // Capture memory leaks
    for (const block of this.heap) {
        if (!block.free) {
            this.runtimeErrors.push({
                phase: 'Memory',
                message: `[Memory Warning] ${block.size} bytes leaked at ${block.address}. Missing free().`,
                line: 0,
                column: 0
            });
        }
    }
    
    return {
      finalDump: this.finalDump || this.dump_memory_state(),
      history: this.history
    };
  }

  private callFunction(name: string, args: any[]): any {
    if (name === 'printf') {
        // Safe mock so the VM doesn't crash on standard C print statements
        return 0; 
    }
    if (name === 'malloc') {
      const size = args[0] || 4;
      const addr = `0x${this.nextHeapAddress.toString(16).toUpperCase()}`;
      this.heap.push({ address: addr, size, free: false, data: null });
      this.nextHeapAddress += size;
      this.recordSnapshot(); // SNAPSHOT: After heap allocation
      return addr;
    }
    if (name === 'free') {
      const addr = args[0];
      const block = this.heap.find(b => b.address === addr);
      if (!block || block.free) {
          throw new Error(`[Segmentation Fault] Attempted to free an unallocated or already freed pointer at ${addr}.`);
      }
      block.free = true;
      this.recordSnapshot(); // SNAPSHOT: After heap free
      return null;
    }
    if (name === 'printf') {
      let outStr = String(args[0] || '').replace(/\\n/g, '\n');
      for (let i = 1; i < args.length; i++) {
        outStr = outStr.replace(/%d|%s|%c|%p/, String(args[i]));
      }
      if (!this.staticMemory['__stdout']) {
          this.staticMemory['__stdout'] = [];
      }
      this.staticMemory['__stdout'].push(outStr);
      this.recordSnapshot();
      return args.length;
    }

    const funcAST = this.functions[name];
    if (!funcAST) return null;

    const locals: Record<string, any> = {};
    if (funcAST.params) {
        funcAST.params.forEach((param: string, i: number) => {
            locals[param] = args[i] || 0;
        });
    }

    // Push the new frame onto the stack
    this.stack.push({ functionName: name, locals });
    
    // SNAPSHOT: Immediately after entering the function (Empty frame visible)
    this.recordSnapshot(); 

    let result = null;
    try {
      this.executeBlock(funcAST.body);
    } catch (e: any) {
      if (e && e.type === 'return') {
        result = e.value;
      } else {
        throw e;
      }
    }

    // Capture the peak execution state for the final dump
    if (!this.finalDump || this.stack.length > this.finalDump.stack.length || name === 'main') {
        this.finalDump = this.dump_memory_state();
    }

    // SNAPSHOT: Right before the function returns and the frame is destroyed
    this.recordSnapshot();

    this.stack.pop();
    
    // SNAPSHOT: After the frame is popped off the stack
    this.recordSnapshot();
    
    return result;
  }

  private executeBlock(block: ASTNode) {
      if (block.type === 'BlockStatement') {
          for (const stmt of block.body) {
              this.executeStatement(stmt);
          }
      }
  }

  private executeStatement(stmt: ASTNode) {
      this.instructionCount++;
      if (this.instructionCount > 10000) {
          throw new Error("[Runtime Error] Execution timeout. Infinite loop detected.");
      }

      switch(stmt.type) {
          case 'VariableDeclaration': {
              let val = stmt.initializer ? this.evaluate(stmt.initializer) : 0;
              if (stmt.arraySize != null) {
                  val = new Array(stmt.arraySize).fill(val);
              }
              this.setLocal(stmt.name, val);
              break;
          }
          case 'ExpressionStatement': {
              this.evaluate(stmt.expression);
              break;
          }
          case 'IfStatement': {
              if (this.evaluate(stmt.condition)) {
                  this.executeStatement(stmt.thenBranch);
              }
              break;
          }
          case 'WhileStatement': {
            // FIX: Actual execution logic for loops in the VM
            while (this.evaluate(stmt.condition)) {
                this.executeStatement(stmt.body);
            }
            break;
        }
          case 'ReturnStatement': {
              const val = stmt.value ? this.evaluate(stmt.value) : null;
              this.recordSnapshot();
              throw { type: 'return', value: val }; 
          }
          case 'BlockStatement': {
              this.executeBlock(stmt);
              break;
          }
      }
      // SNAPSHOT: After variable assignment or expression evaluation
      this.recordSnapshot();
  }

  private setLocal(name: string, value: any) {
      if (this.stack.length > 0) {
          this.stack[this.stack.length - 1].locals[name] = value;
      } else {
          this.staticMemory[name] = value;
      }
  }

  private getLocal(name: string): any {
      if (this.stack.length > 0) {
           if (name in this.stack[this.stack.length - 1].locals) {
                return this.stack[this.stack.length - 1].locals[name];
           }
      }
      if (name in this.staticMemory) {
           return this.staticMemory[name];
      }
      return null;
  }

  private assignValue(left: ASTNode, val: any) {
      if (left.type === 'Identifier') {
          this.setLocal(left.name, val);
      } else if (left.type === 'ArrayAccess') {
          const arr = this.evaluate(left.object);
          const index = this.evaluate(left.index);
          if (arr) arr[index] = val;
      } else if (left.type === 'MemberExpression') {
          const obj = this.evaluate(left.object);
          if (left.operator === '->') {
              const block = this.heap.find(b => b.address === obj);
              if (block) {
                  if (!block.data) block.data = {};
                  block.data[left.property] = val;
              }
          } else {
              if (obj) obj[left.property] = val;
          }
      } else if (left.type === 'DereferenceExpression') {
          const ptr = this.evaluate(left.argument);
          if (typeof ptr === 'string' && ptr.startsWith('0x')) {
              const block = this.heap.find(b => b.address === ptr);
              if (block) block.data = val;
          } else if (typeof ptr === 'string' && ptr.startsWith('&')) {
              const localName = ptr.substring(1);
              this.setLocal(localName, val);
          }
      }
  }

  private evaluate(expr: ASTNode | null): any {
      this.instructionCount++;
      if (this.instructionCount > 10000) {
          throw new Error("[Runtime Error] Execution timeout. Infinite loop detected.");
      }

      if (!expr) return null;
      switch (expr.type) {
          case 'NumberLiteral': return expr.value;
          case 'StringLiteral': return expr.value;
          case 'Identifier': return this.getLocal(expr.name);
          case 'ArrayAccess': {
              const arr = this.evaluate(expr.object);
              const index = this.evaluate(expr.index);
              return arr ? arr[index] : null;
          }
          case 'MemberExpression': {
              const obj = this.evaluate(expr.object);
              if (expr.operator === '->') {
                  // Treat object as a pointer string to heap or local
                  const block = this.heap.find(b => b.address === obj);
                  if (block && block.data) return block.data[expr.property];
                  return obj ? obj[expr.property] : null;
              } else {
                  return obj ? obj[expr.property] : null;
              }
          }
          case 'DereferenceExpression': {
              const ptr = this.evaluate(expr.argument);
              if (typeof ptr === 'string' && ptr.startsWith('0x')) {
                  const block = this.heap.find(b => b.address === ptr);
                  return block ? block.data : null;
              }
              return ptr;
          }
          case 'AddressOfExpression': {
              // Return a string representing address. For now, pretend local ptr is "&name"
              if (expr.argument.type === 'Identifier') {
                  return `&${expr.argument.name}`;
              }
              return '&temp';
          }
          case 'AssignmentExpression': {
              const val = this.evaluate(expr.right);
              this.assignValue(expr.left, val);
              return val;
          }
          case 'BinaryExpression': {
              const l = this.evaluate(expr.left);
              const r = this.evaluate(expr.right);
              switch(expr.operator) {
                  case '+': return l + r;
                  case '-': return l - r;
                  case '*': return l * r;
                  case '/': return l / r;
                  case '==': return l === r;
                  case '!=': return l !== r;
                  case '<': return l < r;
                  case '>': return l > r;
                  case '<=': return l <= r;
                  case '>=': return l >= r;
              }
              return 0;
          }
          case 'CallExpression': {
              const args = expr.arguments.map((a: any) => this.evaluate(a));
              return this.callFunction(expr.callee, args);
          }
          case 'UnaryExpression': {
              const right = this.evaluate(expr.right);
              switch (expr.operator) {
                  case '!': return !right ? 1 : 0;
                  case '-': return -right;
              }
              return right;
          }
          case 'UpdateExpression': {
              let val = this.evaluate(expr.argument);
              const isInc = expr.operator === '++';
              const oldVal = val;
              val = isInc ? val + 1 : val - 1;
              this.assignValue(expr.argument, val);
              return expr.prefix ? val : oldVal;
          }
      }
      return null;
  }
}

/**
 * PART B: The Lexer Implementation
 * 
 * Lexer (Lexical Analyzer)
 * Takes raw source code as a string and converts it into a stream of tokens.
 * Handles primary error recovery (Panic Mode) for unrecognized characters.
 */
export class Lexer {
  private source: string;
  private currentPos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];
  private errors: CompilerError[] = [];

  private keywords = new Set(['int', 'if', 'else', 'return', 'while', 'void', 'struct', 'typedef', 'bool']);
  private operators = new Set(['+', '-', '*', '/', '=', '==', '!=', '<', '>', '<=', '>=', '&', '->', '++', '--', '!']);
  private punctuation = new Set(['{', '}', '(', ')', ';', ',', '.', '[', ']']);

  constructor(source: string) {
    this.source = source;
  }

  public tokenize(): { tokens: Token[], errors: CompilerError[] } {
    while (!this.isAtEnd()) {
      const char = this.peek();

      // 1. Skip preprocessor directives completely
      if (char === '#') {
          while (!this.isAtEnd() && this.peek() !== '\n') {
              this.advance();
          }
          continue;
      }
      
      // Handle comments
      if (char === '/' && this.source[this.currentPos + 1] === '/') {
          while (!this.isAtEnd() && this.peek() !== '\n') {
              this.advance();
          }
          continue;
      }

      if (this.isWhitespace(char)) {
        this.advance();
      } else if (char === '"') {
        this.stringLiteral();
      } else if (this.isAlpha(char)) {
        this.identifierOrKeyword();
      } else if (this.isDigit(char)) {
        this.number();
      } else if (this.punctuation.has(char)) {
        const startCol = this.column;
        this.tokens.push({
            type: TokenType.PUNCTUATION, 
            value: this.advance(), 
            line: this.line, 
            column: startCol 
        });
      } else if (this.isOperatorChar(char)) {
        this.operator();
      } else {
        // PANIC MODE RECOVERY: Lexical Error
        // Invalid character encountered. We log the error, drop the character, 
        // and continue processing to ensure we get as many valid tokens as possible.
        const startCol = this.column;
        const badChar = this.advance();
        this.errors.push({
          phase: 'Lexer',
          message: `Unrecognized character: '${badChar}'`,
          line: this.line,
          column: startCol 
        });
      }
    }

    this.tokens.push({ type: TokenType.EOF, value: '', line: this.line, column: this.column });
    return { tokens: this.tokens, errors: this.errors };
  }

  private isAtEnd(): boolean {
    return this.currentPos >= this.source.length;
  }

  private peek(): string {
    if (this.isAtEnd()) return '\0';
    return this.source[this.currentPos];
  }
  
  private advance(): string {
    const char = this.source[this.currentPos++];
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  private isWhitespace(char: string): boolean {
    return char === ' ' || char === '\r' || char === '\t' || char === '\n';
  }

  private isAlpha(char: string): boolean {
    return (char >= 'a' && char <= 'z') || 
           (char >= 'A' && char <= 'Z') || 
            char === '_';
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }
  
  private isOperatorChar(char: string): boolean {
    return ['+', '-', '*', '/', '=', '<', '>', '!', '&'].includes(char);
  }

  private stringLiteral(): void {
    const startCol = this.column;
    let value = this.advance(); // consume "
    while (this.peek() !== '"' && !this.isAtEnd()) {
        value += this.advance();
    }
    if (!this.isAtEnd()) {
        value += this.advance(); // consume closing "
    } else {
        this.errors.push({ phase: 'Lexer', message: 'Unterminated string literal', line: this.line, column: startCol });
    }
    this.tokens.push({ type: TokenType.STRING, value, line: this.line, column: startCol });
  }

  private identifierOrKeyword(): void {
    const startCol = this.column;
    let value = '';
    while (this.isAlpha(this.peek()) || this.isDigit(this.peek())) {
      value += this.advance();
    }
    const type = this.keywords.has(value) ? TokenType.KEYWORD : TokenType.IDENTIFIER;
    this.tokens.push({ type, value, line: this.line, column: startCol });
  }

  private number(): void {
    const startCol = this.column;
    let value = '';
    while (this.isDigit(this.peek())) {
      value += this.advance();
    }
    this.tokens.push({ type: TokenType.NUMBER, value, line: this.line, column: startCol });
  }

  private operator(): void {
    const startCol = this.column;
    let value = this.advance(); // consume first char
    const expectedTwoChars = value + this.peek();
    
    if (this.operators.has(expectedTwoChars)) {
        value += this.advance();
    }
    
    this.tokens.push({ type: TokenType.OPERATOR, value, line: this.line, column: startCol });
  }
}
