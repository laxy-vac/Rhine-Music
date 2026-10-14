/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 30 мар. 2024 г.
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

#ifndef LSP_PLUG_IN_EXPR_FUNCTIONS_H_
#define LSP_PLUG_IN_EXPR_FUNCTIONS_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/expr/types.h>

namespace lsp
{
    namespace expr
    {

        typedef status_t (* stdfunc_t)(value_t *result, size_t num_args, const value_t *args);

        status_t stdfunc_min(value_t *result, size_t num_args, const value_t *args);
        status_t stdfunc_max(value_t *result, size_t num_args, const value_t *args);
        status_t stdfunc_avg(value_t *result, size_t num_args, const value_t *args);
        status_t stdfunc_rms(value_t *result, size_t num_args, const value_t *args);

    } /* namespace exp */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_EXPR_FUNCTIONS_H_ */
