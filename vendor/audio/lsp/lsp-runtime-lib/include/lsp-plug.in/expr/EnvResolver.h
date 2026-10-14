/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 25 янв. 2023 г.
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

#ifndef LSP_PLUG_IN_EXPR_ENVRESOLVER_H_
#define LSP_PLUG_IN_EXPR_ENVRESOLVER_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/expr/Resolver.h>

namespace lsp
{
    namespace expr
    {
        /**
         * Environment variable resolver
         */
        class EnvResolver: public Resolver
        {
            public:
                explicit EnvResolver();
                virtual ~EnvResolver() override;

            public:
                virtual status_t resolve(value_t *value, const char *name, size_t num_indexes = 0, const ssize_t *indexes = NULL) override;
                virtual status_t resolve(value_t *value, const LSPString *name, size_t num_indexes = 0, const ssize_t *indexes = NULL) override;
        };
    } /* namespace expr */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_EXPR_ENVRESOLVER_H_ */
