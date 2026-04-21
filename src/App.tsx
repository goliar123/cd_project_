import { useState, useEffect, useMemo } from 'react';
import { Lexer, Parser, SemanticAnalyzer, VirtualMachine, MemoryDump, Token, CompilerError } from './lib/compiler';
import { Play, Bug, TerminalSquare, Database, Layers } from 'lucide-react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-c';
import 'prismjs/themes/prism-twilight.css';
import Tree, { RawNodeDatum } from 'react-d3-tree';

const DEFAULT_CODE = `// VisuCode C-like Virtual Machine
// Now supporting Pointers, Arrays, Structs, and Strings!

typedef struct {
    int id;
    int scores[3];
} Student;

int main() {
    // String literal and mock printf function
    printf("Starting VM Execution...\\n");

    // Heap allocation and pointers
    int ptr = malloc(32);
    
    // Struct and Array indexing via dereference
    // (Mocking pointer semantics dynamically)
    *ptr = 100;
    
    // Local Array definition
    int my_array[5];
    my_array[0] = 10;
    my_array[1] = 20;
    
    // Loop
    int i = 0;
    int sum = 0;
    while (i < 2) {
        sum = sum + my_array[i];
        i++;
    }
    
    printf("Sum: %d\\n", sum);
    
    free(ptr);
    return sum;
}`;

// Adapter to transform our raw AST JSON into react-d3-tree format
const adaptASTToD3 = (node: any): RawNodeDatum => {
    if (!node || typeof node !== 'object') {
        return { name: String(node) };
    }
    
    const { type, line, column, ...rest } = node;
    const result: RawNodeDatum = {
        name: type || 'UnknownNode',
        attributes: {},
        children: []
    };
    
    if (line !== undefined) result.attributes!.line = line;
    if (column !== undefined) result.attributes!.column = column;
    
    Object.entries(rest).forEach(([key, val]) => {
        if (Array.isArray(val)) {
            if (val.length > 0) {
                const listNode: RawNodeDatum = {
                    name: key,
                    attributes: { count: val.length },
                    children: val.map(v => adaptASTToD3(v))
                };
                result.children!.push(listNode);
            }
        } else if (typeof val === 'object' && val !== null) {
            const childNode = adaptASTToD3(val);
            result.children!.push({ name: key, children: [childNode] });
        } else {
            result.attributes![key] = String(val);
        }
    });
    
    if (result.children?.length === 0) {
        delete result.children;
    }
    
    return result;
};

// MASSIVE UPGRADE: Custom SVG renderer for the AST nodes
const renderCustomASTNode = ({ nodeDatum, toggleNode }: any) => {
    const type = nodeDatum.name;
    const attrs = nodeDatum.attributes || {};
    
    // Extract meaningful data to show inside the node (variable names, values, operators)
    const displayValue = attrs.name || attrs.value || attrs.operator || attrs.callee || '';

    return (
        <g className="cursor-pointer" onClick={toggleNode}>
            <foreignObject width="300" height="100" x="-150" y="-50">
                <div className="w-full h-full bg-black border-2 border-fuchsia-500 rounded-lg flex flex-col items-center justify-center pointer-events-none">
                    <h3 className="text-white text-lg font-bold font-mono text-center">
                        {type}
                    </h3>
                    {displayValue && (
                        <p className="text-cyan-400 text-sm font-mono text-center mt-1">
                            {displayValue}
                        </p>
                    )}
                </div>
            </foreignObject>
        </g>
    );
};

const getTokenColor = (type: string) => {
    switch (type) {
        case 'KEYWORD': return 'text-fuchsia-400';
        case 'NUMBER': return 'text-emerald-400';
        case 'IDENTIFIER': return 'text-sky-300';
        case 'OPERATOR': 
        case 'PUNCTUATION': return 'text-zinc-400';
        case 'STRING': return 'text-amber-300';
        default: return 'text-zinc-300';
    }
};

export default function App() {
  const [sourceCode, setSourceCode] = useState(DEFAULT_CODE);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [ast, setAst] = useState<any>(null);
  const [scopes, setScopes] = useState<any[]>([]);
  const [errors, setErrors] = useState<CompilerError[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<MemoryDump[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [activeTab, setActiveTab] = useState<'editor' | 'tokens' | 'ast' | 'symbols' | 'memory'>('editor');

  const treeData = useMemo(() => {
      return ast ? adaptASTToD3(ast) : null;
  }, [ast]);

  const handleRunCompilation = (codeToRun = sourceCode) => {
    try {
        const lexer = new Lexer(codeToRun);
        const { tokens: lexerTokens, errors: lexerErrors } = lexer.tokenize();
        setTokens(lexerTokens);
        
        const parser = new Parser(lexerTokens);
        const { ast: parsedAst, errors: parserErrors } = parser.parse();
        setAst(parsedAst);

        const analyzer = new SemanticAnalyzer();
        const { errors: semanticErrors, scopes: generatedScopes } = analyzer.analyze(parsedAst);
        setScopes(generatedScopes);

        const allErrors = [...lexerErrors, ...parserErrors, ...semanticErrors];

        const vm = new VirtualMachine();
        const { history } = vm.execute(parsedAst);
        setMemoryHistory(history);
        setCurrentStep(0)
        
        if (vm.runtimeErrors.length > 0) {
            setErrors([...allErrors, ...vm.runtimeErrors]);
        } else {
            setErrors(allErrors);
        }
    } catch (e: any) {
        setErrors([{ phase: 'System', message: e.message || String(e), line: 0, column: 0 }]);
    }
  };

  useEffect(() => {
    handleRunCompilation(DEFAULT_CODE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentMemory = memoryHistory[currentStep] || null;

  return (
    <div className="min-h-screen bg-black text-zinc-200 font-sans p-4 md:p-8 flex flex-col gap-6">
      <style>{`
        .rd3t-link { 
            stroke: #71717a !important; 
            stroke-width: 3px !important; 
            fill: none !important; 
        }
      `}</style>
      <header className="flex flex-col gap-6">
        <div className="flex items-start justify-between">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                    <TerminalSquare className="w-8 h-8 text-sky-400" />
                    VisuCode VM
                </h1>
                <p className="text-zinc-300 mt-2 max-w-2xl">
                    A visual multi-phase interpreter evaluating static, stack, and heap memory dynamically.
                </p>
            </div>
            <button 
                onClick={() => handleRunCompilation(sourceCode)}
                className="flex items-center gap-2 px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-black rounded-lg font-bold transition-colors shadow-lg shadow-cyan-900/40 border border-cyan-400/50"
            >
                <Play className="w-5 h-5 fill-current" />
                Run Code
            </button>
        </div>

        {/* Top-Level Primary Navigation Bar */}
        <div className="flex bg-zinc-950 border border-zinc-900 rounded-lg p-1 gap-1 shrink-0 shadow-lg">
            <button onClick={() => setActiveTab('editor')} className={`flex-1 flex justify-center items-center gap-2 px-4 py-3 rounded-md font-medium text-sm transition-colors ${activeTab === 'editor' ? 'bg-zinc-800 text-zinc-100 shadow border-zinc-700 border' : 'text-zinc-500 hover:text-zinc-300'}`}>Code Editor</button>
            <button onClick={() => setActiveTab('tokens')} className={`flex-1 flex justify-center items-center gap-2 px-4 py-3 rounded-md font-medium text-sm transition-colors ${activeTab === 'tokens' ? 'bg-zinc-800 text-zinc-100 shadow border-zinc-700 border' : 'text-zinc-500 hover:text-zinc-300'}`}>Token Stream</button>
            <button onClick={() => setActiveTab('ast')} className={`flex-1 flex justify-center items-center gap-2 px-4 py-3 rounded-md font-medium text-sm transition-colors ${activeTab === 'ast' ? 'bg-zinc-800 text-zinc-100 shadow border-zinc-700 border' : 'text-zinc-500 hover:text-zinc-300'}`}>AST Graph</button>
            <button onClick={() => setActiveTab('symbols')} className={`flex-1 flex justify-center items-center gap-2 px-4 py-3 rounded-md font-medium text-sm transition-colors ${activeTab === 'symbols' ? 'bg-zinc-800 text-zinc-100 shadow border-zinc-700 border' : 'text-zinc-500 hover:text-zinc-300'}`}>Symbol Table</button>
            <button onClick={() => setActiveTab('memory')} className={`flex-1 flex justify-center items-center gap-2 px-4 py-3 rounded-md font-medium text-sm transition-colors ${activeTab === 'memory' ? 'bg-zinc-800 text-zinc-100 shadow border-zinc-700 border' : 'text-zinc-500 hover:text-zinc-300'}`}>VM Memory</button>
        </div>
      </header>

      <div className="flex-1 rounded-xl border border-zinc-900 bg-zinc-950 shadow-2xl overflow-hidden relative min-h-[600px] h-[calc(100vh-260px)]">
        {/* TAB: CODE EDITOR */}
        {activeTab === 'editor' && (
            <div className="absolute inset-0 flex flex-col">
                <div className="flex-1 overflow-auto bg-transparent font-mono text-sm leading-relaxed text-zinc-200">
                    <Editor
                      value={sourceCode}
                      onValueChange={code => setSourceCode(code)}
                      highlight={code => Prism.highlight(code, Prism.languages.c || Prism.languages.clike, 'c')}
                      padding={16}
                      className="min-h-full w-full outline-none"
                      textareaClassName="focus:outline-none"
                      style={{ fontFamily: '"Fira code", "Fira Mono", monospace' }}
                    />
                </div>
                <div className="h-64 shrink-0 border-t border-rose-900/40 bg-black overflow-hidden flex flex-col">
                   <div className="bg-rose-950/20 px-4 py-3 border-b border-rose-900/40 shrink-0">
                      <h2 className="text-sm font-bold tracking-widest uppercase text-rose-400 flex items-center gap-2">
                          <Bug className="w-4 h-4" />
                          Compiler Diagnostics
                      </h2>
                  </div>
                  <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-2">
                      {errors.length === 0 ? (
                          <p className="text-zinc-500">✓ Zero compilation errors. VM Executing cleanly.</p>
                      ) : (
                          errors.map((error, i) => (
                              <div key={i} className="flex items-start gap-2 text-rose-400 bg-rose-500/10 p-2.5 rounded border border-rose-500/20">
                                  <span className="shrink-0 text-rose-500 font-bold">[{error.phase}]</span>
                                  <span>{error.message}</span>
                              </div>
                          ))
                      )}
                  </div>
                </div>
            </div>
        )}

        {/* TAB 1: Token Stream */}
        {activeTab === 'tokens' && (
            <div className="absolute inset-0 overflow-auto bg-black">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-zinc-950/90 text-zinc-500 text-xs uppercase tracking-wider sticky top-0 backdrop-blur z-10 border-b border-zinc-900">
                        <tr>
                            <th className="px-6 py-4">Index</th>
                            <th className="px-6 py-4">Token Type</th>
                            <th className="px-6 py-4">Lexeme</th>
                            <th className="px-6 py-4">Line</th>
                            <th className="px-6 py-4">Col</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900 text-zinc-300">
                        {tokens.map((token, i) => (
                            <tr key={i} className="hover:bg-zinc-900/40">
                                <td className="px-6 py-3 font-mono text-zinc-500">{i}</td>
                                <td className={`px-6 py-3 font-mono font-bold ${getTokenColor(token.type)}`}>{token.type}</td>
                                <td className="px-6 py-3 font-mono text-zinc-300">{token.value || 'EOF'}</td>
                                <td className="px-6 py-3 font-mono text-zinc-500">{token.line}</td>
                                <td className="px-6 py-3 font-mono text-zinc-500">{token.column}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}

        {/* TAB 2: THE FIXED AST GRAPH */}
        {activeTab === 'ast' && (
            <div className="absolute inset-0 bg-black overflow-hidden shadow-inner flex flex-col">
                <div className="z-10 absolute top-0 left-0 w-full flex justify-end p-3 pointer-events-none">
                    <span className="text-zinc-500 text-[10px] bg-black/50 px-2 py-1 rounded border border-zinc-900/50">Pan & Zoom to explore</span>
                </div>
                <div className="flex-1 w-full h-[600px] relative cursor-move">
                    {treeData ? (
                        <Tree 
                            data={treeData} 
                            orientation="horizontal" 
                            pathFunc="step" 
                            translate={{ x: 100, y: 300 }}
                            // Significantly increased nodeSize so the large boxes don't overlap
                            nodeSize={{ x: 340, y: 160 }} 
                            separation={{ siblings: 1.1, nonSiblings: 1.5 }}
                            renderCustomNodeElement={renderCustomASTNode}
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-rose-400 font-bold border border-rose-500/20 bg-rose-500/10 rounded-lg m-10 p-6">
                            No AST generated. Check syntax errors.
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* TAB 3: Symbol Table */}
        {activeTab === 'symbols' && (
            <div className="absolute inset-0 overflow-y-auto p-6 bg-black text-zinc-300 font-mono">
                 <pre>{JSON.stringify(scopes, null, 2)}</pre>
            </div>
        )}

        {/* TAB 4: VM Memory */}
        {activeTab === 'memory' && (
            <div className="absolute inset-0 overflow-y-auto font-mono text-sm bg-black flex flex-col">
                {memoryHistory.length > 0 && (
                    <div className="sticky top-0 bg-zinc-950/90 backdrop-blur border-b border-zinc-900 p-3 flex justify-between z-10 shadow-xl">
                        <button 
                            disabled={currentStep === 0} 
                            onClick={() => setCurrentStep(prev => prev - 1)}
                            className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded disabled:opacity-50 text-xs font-bold"
                        >⏮ Step Back</button>
                        <span className="text-sky-400 text-xs font-bold uppercase py-1.5">
                            Snapshot {currentStep + 1} of {memoryHistory.length}
                        </span>
                        <button 
                            disabled={currentStep === memoryHistory.length - 1} 
                            onClick={() => setCurrentStep(prev => prev + 1)}
                            className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded disabled:opacity-50 text-xs font-bold"
                        >Step Forward ⏭</button>
                    </div>
                )}

                <div className="p-6 space-y-8">
                    <div className="space-y-3">
                        <h3 className="text-zinc-100 font-bold flex items-center gap-2 pb-2 border-b border-zinc-900">
                            <Database className="w-5 h-5 text-sky-400" /> Static Globals
                        </h3>
                        <div className="pl-7 space-y-2">
                            {currentMemory && Object.entries(currentMemory.static).map(([k, v]) => (
                                <div key={k} className="flex gap-3"><span className="text-sky-300">{k}:</span><span className="text-emerald-400">{JSON.stringify(v)}</span></div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h3 className="text-zinc-100 font-bold flex items-center gap-2 pb-2 border-b border-zinc-900">
                            <Layers className="w-5 h-5 text-fuchsia-400" /> Heap Segment
                        </h3>
                        <div className="pl-7 grid grid-cols-2 gap-4">
                            {currentMemory && currentMemory.heap.map((block, i) => (
                                <div key={i} className={`p-3 rounded border flex flex-col gap-2 ${block.free ? 'border-zinc-800 text-zinc-500' : 'bg-fuchsia-500/10 border-fuchsia-500/20 text-zinc-300'}`}>
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold tracking-widest">{block.address}</span>
                                        <span className={`text-[10px] font-bold ${block.free ? 'text-zinc-500' : 'text-fuchsia-400'}`}>{block.free ? 'FREED' : 'ALLOCATED'}</span>
                                    </div>
                                    <span className="text-emerald-400 text-xs">{block.size} BYTES</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h3 className="text-zinc-100 font-bold flex items-center gap-2 pb-2 border-b border-zinc-900">
                            <Layers className="w-5 h-5 text-amber-300" /> Execution Stack
                        </h3>
                        <div className="pl-7 space-y-4 flex flex-col-reverse">
                            {currentMemory && currentMemory.stack.map((frame, i) => (
                                <div key={i} className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-4">
                                    <div className="border-b border-amber-500/10 pb-2 mb-3 text-amber-300 font-bold">{frame.functionName}() Frame</div>
                                    {Object.entries(frame.locals).map(([k, v]) => (
                                        <div key={k} className="flex gap-3 text-sm">
                                            <span className="text-sky-300">{k}:</span>
                                            <span className="text-emerald-400">{JSON.stringify(v)}</span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}