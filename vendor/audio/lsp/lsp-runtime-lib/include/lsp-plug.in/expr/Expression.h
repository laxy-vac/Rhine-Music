/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 16 сент. 2019 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_EXPR_EXPRESSION_H_
#define LSP_PLUG_IN_EXPR_EXPRESSION_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/IInSequence.h>
#include <lsp-plug.in/expr/types.h>
#include <lsp-plug.in/expr/Resolver.h>

#include <lsp-plug.in/lltl/darray.h>
#include <lsp-plug.in/lltl/parray.h>

namespace lsp
{
    namespace expr
    {
        struct expr_t;
        class Tokenizer;
        
        class Expression
        {
            public:
                enum expr_flags
                {
                    FLAG_NONE           = 0,
                    FLAG_MULTIPLE       = 1 << 0,
                    FLAG_STRING         = 1 << 1
                };

            protected:
                typedef struct root_t
                {
                    expr_t                     *expr;
                    value_t                     result;
                } root_t;

            protected:
                Resolver                   *pResolver;
                lltl::darray<root_t>        vRoots;
                lltl::parray<LSPString>     vDependencies;

            protected:
                void                destroy_all_data();
                status_t            prepend_string(expr_t **expr, const LSPString *str, bool force);
                status_t            parse_substitution(expr_t **expr, Tokenizer *t);
                status_t            parse_regular(io::IInSequence *seq, size_t flags);
                status_t            parse_string(io::IInSequence *seq, size_t flags);
                status_t            post_process();
                status_t            scan_dependencies(expr_t *expr);
                status_t            add_dependency(const LSPString *str);

            public:
                explicit Expression();
                explicit Expression(Resolver *res);
                Expression(const Expression &) = delete;
                Expression(Expression &&) = delete;
                virtual ~Expression();

                Expression & operator = (const Expression &) = delete;
                Expression & operator = (Expression &&) = delete;

                void destroy();

            public:
                /**
                 * Parse the expression
                 * @param expr string containing expression in UTF-8
                 * @param flags additional flags
                 * @return status of operation
                 */
                status_t    parse(const char *expr, size_t flags = FLAG_NONE);

                /**
                 * Parse the expression
                 * @param expr string containing expression
                 * @param charset character set, UTF-8 if NULL
                 * @param flags additional flags
                 * @return status of operation
                 */
                status_t    parse(const char *expr, const char *charset = NULL, size_t flags = FLAG_NONE);

                /**
                 * Parse the expression
                 * @param expr string containing expression
                 * @param flags additional flags
                 * @return status of operation
                 */
                status_t    parse(const LSPString *expr, size_t flags = FLAG_NONE);

                /**
                 * Parse the expression
                 * @param seq character input sequence
                 * @param flags additional flags
                 * @return status of operation
                 */
                status_t    parse(io::IInSequence *seq, size_t flags = FLAG_NONE);

                /**
                 * Check that expression is valid
                 * @return true if the expression is valid
                 */
                inline bool     valid() const { return vRoots.size() > 0; };

                /**
                 * Evaluate all the expressions
                 * @param result pointer to return value of the zero-indexed expression
                 * @return status of operation
                 */
                status_t        evaluate(value_t *result = NULL);

                /**
                 * Evaluate the specific expression
                 * @param idx expression index
                 * @param result pointer to return value of the specified expression
                 * @return status of operation
                 */
                status_t        evaluate(size_t idx, value_t *result = NULL);

                /**
                 * Get number of results
                 * @return number of results
                 */
                inline size_t   results() const { return vRoots.size(); };

                /**
                 * Get result of the specific expression
                 * @param result the pointer to store the result
                 * @param idx the result indes
                 * @return status of operation
                 */
                status_t        result(value_t *result, size_t idx);

                /**
                 * Get variable resolver
                 * @return variable resolver
                 */
                inline Resolver *resolver() { return pResolver; }

                /**
                 * Sett variable resolver
                 * @param resolver variable resolver
                 */
                inline void     set_resolver(Resolver *resolver) { pResolver = resolver; }

                /**
                 * Get number of dependencies
                 * @return number of dependencies
                 */
                inline size_t   dependencies() const { return vDependencies.size(); }

                /**
                 * Get dependency
                 * @param idx the index of dependency
                 * @return dependency name or NULL
                 */
                inline const LSPString *dependency(size_t idx) const { return vDependencies.get(idx); }

                /**
                 * Check that expression has dependency
                 * @param str dependency name
                 * @return true if expression has dependency
                 */
                bool            has_dependency(const LSPString *str) const;

                /**
                 * Check that expression has dependency
                 * @param str dependency name
                 * @return true if expression has dependency
                 */
                bool            has_dependency(const char *str) const;

        };
    
    } /* namespace calc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_EXPR_EXPRESSION_H_ */
