/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 18 сент. 2019 г.
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

#ifndef LSP_PLUG_IN_EXPR_PARSER_H_
#define LSP_PLUG_IN_EXPR_PARSER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/expr/types.h>
#include <lsp-plug.in/expr/evaluator.h>
#include <lsp-plug.in/expr/Tokenizer.h>

namespace lsp
{
    namespace expr
    {
        enum expr_type_t
        {
            ET_CALC,
            ET_RESOLVE,
            ET_CALL,
            ET_VALUE
        };

        typedef struct expr_t
        {
            evaluator_t     eval;       // Evaluation routine
            expr_type_t     type;       // Expression data type
            union
            {
                struct
                {
                    expr_t     *left;       // First operand (unary, binary, ternary)
                    expr_t     *right;      // Second operand (binary, ternary)
                    expr_t     *cond;       // Condition (ternary)
                } calc;

                struct
                {
                    LSPString  *name;       // Base name of variable
                    size_t      count;      // Number of additional indexes
                    expr_t    **items;      // List of additional indexes
                } resolve;

                struct
                {
                    LSPString  *name;       // Base name of function
                    size_t      count;      // Number of additional indexes
                    expr_t    **items;      // List of additional indexes
                } call;

                value_t     value;          // Value
            };
        } expr_t;

        expr_t  *parse_create_expr();
        void    parse_destroy(expr_t *expr);

        status_t parse_ternary(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_or(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_xor(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_and(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_bit_or(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_bit_xor(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_bit_and(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_cmp_eq(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_cmp_rel(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_strcat(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_strrep(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_addsub(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_muldiv(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_power(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_not(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_sign(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_func(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_primary(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_identifier(expr_t **expr, Tokenizer *t, size_t flags);
        status_t parse_call(expr_t **expr, Tokenizer *t, size_t flags);

        status_t parse_expression(expr_t **expr, Tokenizer *t, size_t flags);

    } /* namespace expr */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_EXPR_PARSER_H_ */
